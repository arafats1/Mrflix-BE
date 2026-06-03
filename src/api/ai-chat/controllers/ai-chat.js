'use strict';

/**
 * AI Movie Assistant Controller
 * Uses OpenAI to help users discover movies based on natural language queries
 */
/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

/** @param {unknown} value */
function stripCodeFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

/** @param {unknown} dataUrl */
function parseDataUrlImage(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) return null;

  return { buffer, mime, filename: `product-source.${mime.split('/')[1] || 'png'}` };
}

/** @param {unknown} imageUrl */
async function fetchImageForOpenAI(imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const response = await fetch(url);
  if (!response.ok) return null;

  const mime = String(response.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('image/')) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) return null;

  return { buffer, mime, filename: `product-source.${mime.split('/')[1] || 'png'}` };
}

/**
 * @param {unknown} value
 * @param {string} fallbackName
 */
function normalizeCreativeCopy(value, fallbackName) {
  /** @type {Record<string, any>} */
  const parsed = value && typeof value === 'object' ? value : {};
  const headline = String(parsed.headline || fallbackName || 'Promote your product').trim().slice(0, 90);
  const primaryText = String(parsed.primaryText || parsed.body || '').trim().slice(0, 280);
  const description = String(parsed.description || '').trim().slice(0, 120);
  const callToAction = String(parsed.callToAction || 'Shop now').trim().slice(0, 32);
  const overlayTexts = Array.isArray(parsed.overlayTexts)
    ? parsed.overlayTexts.map(/** @param {unknown} item */(item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];

  return {
    headline: headline || 'Promote your product',
    primaryText: primaryText || `Discover ${fallbackName || 'this product'} today.`,
    description,
    callToAction: callToAction || 'Shop now',
    overlayTexts: overlayTexts.length ? overlayTexts : [headline || 'New arrival', callToAction || 'Shop now'],
  };
}

/** @param {unknown} value */
function normalizeMarketplaceImagePurpose(value) {
  const raw = String(value || '').trim();
  if (raw === 'product_images') return 'product_images';
  if (raw === 'product_polish') return 'product_polish';
  if (raw === 'model_poster') return 'model_poster';
  if (raw === 'model_carousel') return 'model_carousel';
  return 'ad_creatives';
}

/** @param {any} ctx */
async function resolveUser(ctx) {
  if (ctx.state.user?.id) return ctx.state.user;

  const authHeader = String(ctx.request?.headers?.authorization || '');
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;

  try {
    const token = authHeader.slice(7);
    const payload = await strapi.plugins['users-permissions'].services.jwt.verify(token);
    if (!payload?.id) return null;
    return await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: payload.id },
      populate: { role: true },
    });
  } catch {
    return null;
  }
}

module.exports = {
  /** @param {any} ctx */
  async chat(ctx) {
    const { message, history, luganda } = ctx.request.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return ctx.badRequest('Message is required');
    }

    if (message.length > 500) {
      return ctx.badRequest('Message too long (max 500 characters)');
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      strapi.log.error('OPENAI_API_KEY not configured');
      return ctx.badRequest('AI assistant is not configured');
    }

    try {
      const normalizedMessage = message.trim();
      const messageLower = normalizedMessage.toLowerCase();
      const asksForLuganda = /(\bluganda\b|\btranslated\b|\blocal language\b|\bin luganda\b|\buganda\b)/i.test(normalizedMessage);

      const isLugandaMode = luganda === true || luganda === 'true' || asksForLuganda;
      const movieFilters = {
        isAvailable: true,
        genres: { $containsi: 'animation' },
        ...(isLugandaMode && { isLuganda: true }),
      };

      // Fetch a representative slice from every section so the assistant can
      // help users across the whole platform (movies + marketplace + books +
      // music + jobs + courses + education materials + stories).
      /** @param {Promise<any>} p */
      const safe = async (p) => {
        try {
          return await p;
        } catch (e) {
          const error = /** @type {any} */ (e);
          strapi.log.warn('AI Chat fetch failed:', error?.message || error);
          return [];
        }
      };

      const [
        movies,
        products,
        books,
        tracks,
        jobs,
        entrepCourses,
        eduMaterials,
      ] = await Promise.all([
        safe(strapi.entityService.findMany('api::movie.movie', {
          filters: movieFilters,
          fields: ['title', 'overview', 'genres', 'type', 'rating', 'releaseDate', 'countryOfOrigin', 'priceUGX', 'seasons', 'trailerUrl', 'isLuganda', 'vjName', 'isAdult'],
          sort: 'createdAt:desc',
          limit: 150,
        })),
        safe(strapi.entityService.findMany('api::product.product', {
          filters: { status: 'active' },
          fields: ['name', 'description', 'priceUGX', 'category', 'itemType', 'audience', 'ageRange', 'discountPercent'],
          sort: 'createdAt:desc',
          limit: 40,
        })),
        safe(strapi.entityService.findMany('api::book.book', {
          filters: { isPublished: true },
          fields: ['title', 'author', 'description', 'category', 'format', 'audienceType', 'educationLevel', 'subject', 'classLabel'],
          sort: 'createdAt:desc',
          limit: 40,
        })),
        safe(strapi.entityService.findMany('api::music.music', {
          filters: { isPublished: true },
          fields: ['title', 'artist', 'description', 'mediaType', 'genres', 'religiousCategory', 'childAgeGroup', 'isExclusive'],
          sort: 'createdAt:desc',
          limit: 40,
        })),
        safe(strapi.entityService.findMany('api::entrep-job.entrep-job', {
          filters: { status: { $in: ['open', 'active'] } },
          fields: ['title', 'company', 'jobFunction', 'industry', 'experienceLevel', 'location', 'jobType', 'salary'],
          sort: 'createdAt:desc',
          limit: 30,
        })),
        safe(strapi.entityService.findMany('api::entrep-course.entrep-course', {
          filters: { status: { $in: ['approved', 'published'] } },
          fields: ['title', 'shortDescription', 'category', 'level', 'durationWeeks', 'priceUGX', 'providerName'],
          sort: 'createdAt:desc',
          limit: 30,
        })),
        safe(strapi.entityService.findMany('api::provider-material.provider-material', {
          filters: { status: { $in: ['published', 'approved'] } },
          fields: ['title', 'description', 'providerType', 'contentCategory', 'educationLevel', 'religion', 'ageRange', 'priceUGX', 'mediaType'],
          sort: 'createdAt:desc',
          limit: 40,
        })),
      ]);

      // Build movie catalog summary (kept for mentionedMovies linking + request flow)
      const catalog = movies.map(/** @param {any} m */ (m) => {
        const parts = [`"${m.title}" (${m.type})`];
        if (m.genres?.length) parts.push(`Genres: ${Array.isArray(m.genres) ? m.genres.join(', ') : m.genres}`);
        if (m.rating) parts.push(`Rating: ${m.rating}/10`);
        if (m.releaseDate) parts.push(`Released: ${m.releaseDate}`);
        if (m.countryOfOrigin) parts.push(`Country: ${m.countryOfOrigin}`);
        if (m.type === 'series' && m.seasons) parts.push(`${m.seasons} seasons`);
        if (m.isLuganda) parts.push(`Luganda Translated${m.vjName ? ` by VJ ${m.vjName}` : ''}`);
        if (m.isAdult) parts.push('Adult 18+');
        if (m.overview) parts.push(`Plot: ${m.overview.substring(0, 150)}`);
        return parts.join(' | ');
      }).join('\n');

      // Build compact catalogs for the other sections
      const productCatalog = products.map(/** @param {any} p */ (p) => {
        const parts = [`"${p.name}"`];
        if (p.category) parts.push(`Category: ${p.category}`);
        if (p.itemType) parts.push(`Type: ${p.itemType}`);
        if (p.audience) parts.push(`For: ${p.audience}`);
        if (p.priceUGX) parts.push(`UGX ${p.priceUGX}${p.discountPercent ? ` (-${p.discountPercent}%)` : ''}`);
        if (p.description) parts.push(String(p.description).substring(0, 120));
        return parts.join(' | ');
      }).join('\n');

      const bookCatalog = books.map(/** @param {any} b */ (b) => {
        const parts = [`"${b.title}"`];
        if (b.author) parts.push(`by ${b.author}`);
        if (b.category) parts.push(`Category: ${b.category}`);
        if (b.format) parts.push(`Format: ${b.format}`);
        if (b.audienceType) parts.push(`Audience: ${b.audienceType}`);
        if (b.educationLevel) parts.push(`Level: ${b.educationLevel}${b.classLabel ? ` ${b.classLabel}` : ''}`);
        if (b.subject) parts.push(`Subject: ${b.subject}`);
        if (b.description) parts.push(String(b.description).substring(0, 120));
        return parts.join(' | ');
      }).join('\n');

      const musicCatalog = tracks.map(/** @param {any} t */ (t) => {
        const parts = [`"${t.title}"`];
        if (t.artist) parts.push(`by ${t.artist}`);
        if (t.genres?.length) parts.push(`Genres: ${Array.isArray(t.genres) ? t.genres.join(', ') : t.genres}`);
        if (t.religiousCategory) parts.push(`Religion: ${t.religiousCategory}`);
        if (t.mediaType) parts.push(`Media: ${t.mediaType}`);
        return parts.join(' | ');
      }).join('\n');

      const jobCatalog = jobs.map(/** @param {any} j */ (j) => {
        const parts = [`"${j.title}"`];
        if (j.company) parts.push(`at ${j.company}`);
        if (j.location) parts.push(`Location: ${j.location}`);
        if (j.jobType) parts.push(`Type: ${j.jobType}`);
        if (j.experienceLevel) parts.push(`Level: ${j.experienceLevel}`);
        if (j.industry) parts.push(`Industry: ${j.industry}`);
        if (j.salary) parts.push(`Salary: ${j.salary}`);
        return parts.join(' | ');
      }).join('\n');

      const courseCatalog = entrepCourses.map(/** @param {any} c */ (c) => {
        const parts = [`"${c.title}"`];
        if (c.providerName) parts.push(`by ${c.providerName}`);
        if (c.category) parts.push(`Category: ${c.category}`);
        if (c.level) parts.push(`Level: ${c.level}`);
        if (c.durationWeeks) parts.push(`${c.durationWeeks} weeks`);
        if (c.priceUGX != null) parts.push(`UGX ${c.priceUGX}`);
        if (c.shortDescription) parts.push(String(c.shortDescription).substring(0, 120));
        return parts.join(' | ');
      }).join('\n');

      const eduCatalog = eduMaterials.map(/** @param {any} m */ (m) => {
        const parts = [`"${m.title}"`];
        if (m.providerType) parts.push(`Provider: ${m.providerType}`);
        if (m.contentCategory) parts.push(`Category: ${m.contentCategory}`);
        if (m.educationLevel) parts.push(`Level: ${m.educationLevel}`);
        if (m.religion) parts.push(`Religion: ${m.religion}`);
        if (m.ageRange) parts.push(`Age: ${m.ageRange}`);
        if (m.mediaType) parts.push(`Media: ${m.mediaType}`);
        if (m.priceUGX != null) parts.push(`UGX ${m.priceUGX}`);
        return parts.join(' | ');
      }).join('\n');

      const sectionsBlock = `
=========================
ANIMATED MOVIES & SERIES (Movo Kids — section URL: /browse, watch at /watch/{id})
${catalog || '(no titles loaded)'}

=========================
MARKETPLACE PRODUCTS (section URL: /marketplace)
${productCatalog || '(no products loaded)'}

=========================
BOOKS LIBRARY (section URL: /books)
${bookCatalog || '(no books loaded)'}

=========================
MUSIC TRACKS (section URL: /music)
${musicCatalog || '(no tracks loaded)'}

=========================
JOBS BOARD (section URL: /jobs)
${jobCatalog || '(no jobs loaded)'}

=========================
ENTREPRENEUR COURSES (section URL: /entrepreneur)
${courseCatalog || '(no courses loaded)'}

=========================
EDUCATION / PROVIDER MATERIALS (section URL: /education)
${eduCatalog || '(no materials loaded)'}
`.trim();

      strapi.log.info(`AI Chat: luganda=${luganda} movies=${movies.length} products=${products.length} books=${books.length} music=${tracks.length} jobs=${jobs.length} courses=${entrepCourses.length} edu=${eduMaterials.length}`);

      const sharedPlatformRules = `
You are MOVO AI — the friendly assistant for the MOVO platform (a Uganda-based multi-section service). You can help users discover and navigate ANY of these sections:

1. Movo Kids — animated movies & series for kids/families (URL: /browse, watch /watch/{id})
2. Marketplace — products and services for sale (URL: /marketplace)
3. Books — readable & audio books library (URL: /books)
4. Music — music tracks & videos (URL: /music)
5. Jobs — jobs board where users can find work or post jobs (URL: /jobs)
6. Entrepreneur Academy — online courses, mentorship, events (URL: /entrepreneur)
7. Education / Provider Materials — school, religious, and tutor materials (URL: /education)
8. Luganda — Luganda-translated movies (URL: /luganda)

GENERAL RULES — STRICTLY FOLLOW:
- LINKS / URLS: NEVER use any absolute domain like "movo.com", "movobrands.com", "https://...", or "www....". ALWAYS use root-relative paths only (e.g. /marketplace, /jobs, /books). When you include a link in markdown, write it as [text](/marketplace) — the path MUST start with a single "/" and contain NO domain. The platform will resolve the correct domain automatically.
- You have access to the catalogs below. ONLY recommend titles/items that actually appear in the catalogs. NEVER invent titles, prices, courses, jobs, products, or books from your training data — if it is not listed, it does not exist on this platform.
- Detect what the user is asking about (movies, products, books, music, jobs, courses, education materials) and answer from the matching section. If the user is vague, ask a brief clarifying question.
- You can also recommend across sections — e.g. if a user asks about "kids", you can mention animated movies, kids books, and kids music together.
- Be conversational, friendly, and concise (2-4 sentences per recommendation). Recommend up to 5 items at a time.
- When recommending, use the EXACT title from the catalog and tell the user which section to find it in (and the URL where helpful).
- If the user asks for something specific (e.g. "Frozen", "a plumber in Kampala", "a Math S4 textbook") and it is NOT in any catalog, politely say it's not available yet. For movies specifically, you may offer: "Would you like me to submit a request to have it added? Just say yes and I'll handle it." Do NOT offer this request flow for non-movie sections.
- NEVER recommend or mention adult, XXX, or porn content. If asked, redirect: "For our XXX Rated exclusive collection, subscribe to our **Monthly Exclusive** package! 👉 [Subscribe here](/subscribe)"
- Some movies are marked "Adult 18+". Only recommend these when the user explicitly asks for adult content (non-XXX).
- Respond in English but understand if users mix Luganda or other local languages.
- When a user confirms a movie request (says yes, sure, please), respond with EXACTLY: "Great! I'll need your name and WhatsApp number so we can notify you when it's available." Do NOT submit anything yourself.

CATALOGS (the ONLY items available on the platform — recommend strictly from these):
${sectionsBlock}`;

      const systemPrompt = isLugandaMode
        ? `${sharedPlatformRules}

LUGANDA MODE ACTIVE: The user is browsing the Luganda section. When recommending movies, ONLY recommend titles marked "Luganda Translated" in the movies catalog above, and mention the VJ if listed. You can still help with other sections (marketplace, books, music, jobs, courses, education) normally.`
        : sharedPlatformRules;

      // Build conversation messages
      const messages = [{ role: 'system', content: systemPrompt }];

      // Add conversation history (max 10 recent messages to stay within token limits)
      if (Array.isArray(history)) {
        const recentHistory = history.slice(-10);
        for (const msg of recentHistory) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({ role: msg.role, content: String(msg.content).substring(0, 500) });
          }
        }
      }

      messages.push({ role: 'user', content: message.trim() });

      // Call OpenAI
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          max_tokens: 500,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        strapi.log.error('OpenAI API error:', err);
        return ctx.badRequest('AI assistant is temporarily unavailable');
      }

      const data = await response.json();
      let reply = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response. Please try again.';

      // Sanitize any hallucinated absolute domains the model may have emitted.
      // We always want links to be root-relative so the browser uses the
      // current host (e.g. movobrands.com, dev domains, preview deployments).
      /** @param {string} _match @param {string} _origin @param {string | undefined} path */
      const stripHallucinatedDomain = (_match, _origin, path) => path || '/';
      reply = reply.replace(
        /(https?:\/\/(?:www\.)?(?:movo|movobrands|movokids|mrflix)[a-z0-9.-]*)(\/[^\s)\]]*)?/gi,
        stripHallucinatedDomain
      );

      // Safety net: if Luganda mode has catalog items but model says none available,
      // return concrete alternatives from the catalog instead of false negatives.
      const replyLower = reply.toLowerCase();
      const indicatesUnavailable = (
        replyLower.includes("don't have") ||
        replyLower.includes('not available') ||
        replyLower.includes('does not exist') ||
        replyLower.includes("isn't available") ||
        replyLower.includes('not in our catalog')
      );

      if (isLugandaMode && movies.length > 0 && indicatesUnavailable) {
        const keywordMap = {
          action: ['action', 'thriller', 'adventure', 'crime', 'war'],
          comedy: ['comedy', 'funny', 'humor'],
          horror: ['horror', 'scary', 'terror'],
          romance: ['romance', 'romantic', 'love'],
          drama: ['drama'],
          family: ['family', 'kids', 'children'],
          sciFi: ['sci-fi', 'science fiction', 'science-fiction', 'space'],
          animation: ['animation', 'animated', 'cartoon', 'anime'],
          series: ['series', 'show', 'season', 'episodes'],
          movie: ['movie', 'film', 'cinema']
        };

        const wantedKeywords = Object.values(keywordMap)
          .flat()
          .filter((kw) => messageLower.includes(kw));

        /** @param {any} m */
        const scoreMovie = (m) => {
          const genres = Array.isArray(m.genres)
            ? m.genres.join(' ').toLowerCase()
            : String(m.genres || '').toLowerCase();
          const hay = `${m.title || ''} ${genres} ${m.overview || ''}`.toLowerCase();

          if (wantedKeywords.length === 0) return 1;

          let score = 0;
          for (const kw of wantedKeywords) {
            if (hay.includes(kw)) score += 2;
          }
          return score;
        };

        const ranked = movies
          .map(/** @param {any} m */ (m) => ({ movie: m, score: scoreMovie(m) }))
          .sort(/** @param {{ score: number }} a @param {{ score: number }} b */ (a, b) => b.score - a.score)
          .map(/** @param {{ movie: any }} x */ (x) => x.movie);

        const topMatches = ranked.slice(0, 5);
        if (topMatches.length > 0) {
          const lines = topMatches.map(/** @param {any} m */ (m) => {
            const genreText = Array.isArray(m.genres) ? m.genres.join(', ') : (m.genres || 'General');
            return `- ${m.title}${m.vjName ? ` (VJ ${m.vjName})` : ''} — ${genreText}`;
          });

          reply = `Here are some Luganda titles you can watch right now:\n${lines.join('\n')}\n\nIf you want, I can narrow this down to a specific vibe (pure action, comedy, family, or series).`;
        }
      }

      // Extract mentioned movie titles for linking
      const mentionedMovies = movies.filter(/** @param {any} m */ (m) =>
        reply.toLowerCase().includes(m.title.toLowerCase())
      ).map(/** @param {any} m */ (m) => ({
        id: m.documentId || m.id,
        title: m.title,
        type: m.type,
        trailerUrl: m.trailerUrl || null,
      }));

      // Detect if the AI is suggesting a movie request (movie not in catalog)
      const finalReplyLower = reply.toLowerCase();
      const suggestsRequest = (
        finalReplyLower.includes('not available') ||
        finalReplyLower.includes('not in our catalog') ||
        finalReplyLower.includes("isn't available") ||
        finalReplyLower.includes("don't have") ||
        finalReplyLower.includes('submit a request') ||
        finalReplyLower.includes('request to have it')
      );

      // Detect if the AI is asking for name/WhatsApp (user said yes to request)
      const collectingInfo = (
        finalReplyLower.includes('whatsapp number') ||
        finalReplyLower.includes('whatsapp') && finalReplyLower.includes('notify you')
      );

      // Try to extract the unavailable movie title from the user's message
      let requestTitle = null;
      if (suggestsRequest) {
        // The user asked for something — use their message as the title hint
        requestTitle = message.trim();
      }

      return {
        data: {
          reply,
          mentionedMovies,
          ...(suggestsRequest && { suggestRequest: true, requestTitle }),
          ...(collectingInfo && { collectingInfo: true }),
        },
      };
    } catch (err) {
      strapi.log.error('AI chat error:', err);
      return ctx.badRequest('AI assistant encountered an error');
    }
  },

  /** @param {any} ctx */
  async generateMarketplaceDescription(ctx) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      strapi.log.error('OPENAI_API_KEY not configured');
      return ctx.badRequest('AI assistant is not configured');
    }

    const user = await resolveUser(ctx);
    if (!user?.id) {
      return ctx.unauthorized('Authentication required');
    }

    const rawName = ctx.request.body?.name;
    const rawItemType = ctx.request.body?.itemType;
    const rawCategory = ctx.request.body?.category;

    const name = String(rawName || '').trim();
    const itemType = String(rawItemType || 'product').trim().toLowerCase() === 'service' ? 'service' : 'product';
    const category = String(rawCategory || '').trim();

    if (!name || name.length < 2) {
      return ctx.badRequest('Product or service name is required');
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.7,
          max_tokens: 220,
          messages: [
            {
              role: 'system',
              content: [
                'You write marketplace descriptions for MOVO sellers in Uganda.',
                'Return plain text only.',
                'Write a maximum of two short paragraphs.',
                'Do not use markdown, bullet points, headings, hashtags, or emojis.',
                'Keep the tone clear, confident, and practical.',
                'Mention useful buyer details like purpose, quality, fit, use case, or service outcome, but do not invent unavailable specifications.',
              ].join(' '),
            },
            {
              role: 'user',
              content: [
                `Name: ${name}`,
                `Type: ${itemType}`,
                category ? `Category: ${category}` : null,
                'Write a strong description the seller can edit before publishing.',
              ].filter(Boolean).join('\n'),
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        strapi.log.error('OpenAI marketplace description error:', err);
        return ctx.badRequest('AI description is temporarily unavailable');
      }

      const data = await response.json();
      const description = String(data?.choices?.[0]?.message?.content || '')
        .trim()
        .replace(/^['"\s]+|['"\s]+$/g, '')
        .replace(/\n{3,}/g, '\n\n');

      if (!description) {
        return ctx.badRequest('AI description is temporarily unavailable');
      }

      return {
        data: {
          description,
        },
      };
    } catch (err) {
      strapi.log.error('Marketplace description AI error:', err);
      return ctx.badRequest('AI description is temporarily unavailable');
    }
  },

  /** @param {any} ctx */
  async generateMarketplaceAdCreatives(ctx) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      strapi.log.error('OPENAI_API_KEY not configured');
      return ctx.badRequest('AI image generation is not configured');
    }

    const user = await resolveUser(ctx);
    if (!user?.id) {
      return ctx.unauthorized('Authentication required');
    }

    const payload = ctx.request.body || {};
    const productName = String(payload.productName || payload.name || '').trim();
    const description = String(payload.description || '').trim();
    const category = String(payload.category || '').trim();
    const audience = String(payload.audience || '').trim();
    const purpose = normalizeMarketplaceImagePurpose(payload.purpose || 'ad_creatives');
    const priceLabel = String(payload.priceLabel || '').trim();
    const sourceImageDataUrl = String(payload.sourceImageDataUrl || '').trim();
    const sourceImageUrl = String(payload.sourceImageUrl || '').trim();
    const modelImageDataUrl = String(payload.modelImageDataUrl || '').trim();
    const modelImageUrl = String(payload.modelImageUrl || '').trim();
    const marketplaceLogoUrl = String(payload.marketplaceLogoUrl || '').trim();
    const movoBrandsLogoUrl = String(payload.movoBrandsLogoUrl || '').trim();
    const posterStyle = String(payload.posterStyle || '').trim();
    const count = clampNumber(payload.count, 1, 4, 3);

    if (!productName || productName.length < 2) {
      return ctx.badRequest('Product name is required');
    }

    let sourceImage = parseDataUrlImage(sourceImageDataUrl);
    if (!sourceImage && sourceImageUrl) {
      try {
        sourceImage = await fetchImageForOpenAI(sourceImageUrl);
      } catch (err) {
        strapi.log.warn(`Could not fetch source product image: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let modelImage = parseDataUrlImage(modelImageDataUrl);
    if (!modelImage && modelImageUrl) {
      try {
        modelImage = await fetchImageForOpenAI(modelImageUrl);
      } catch (err) {
        strapi.log.warn(`Could not fetch model image: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let marketplaceLogo = null;
    if (marketplaceLogoUrl && purpose !== 'model_poster' && purpose !== 'model_carousel') {
      try {
        marketplaceLogo = await fetchImageForOpenAI(marketplaceLogoUrl);
      } catch (err) {
        strapi.log.warn(`Could not fetch marketplace logo: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let movoBrandsLogo = null;
    if (movoBrandsLogoUrl && purpose !== 'model_poster' && purpose !== 'model_carousel') {
      try {
        movoBrandsLogo = await fetchImageForOpenAI(movoBrandsLogoUrl);
      } catch (err) {
        strapi.log.warn(`Could not fetch MOVO Brands logo: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (purpose === 'model_poster' && (!sourceImage || !modelImage)) {
      return ctx.badRequest('A model image and product image are required for model poster generation');
    }

    if (purpose === 'model_carousel' && !sourceImage) {
      return ctx.badRequest('A product image is required for carousel image generation');
    }

    try {
      const copyResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.75,
          max_tokens: 280,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: [
                'You create concise paid social ad copy for MOVO marketplace sellers in Uganda.',
                'Return only JSON with headline, primaryText, description, callToAction, and overlayTexts array.',
                'Keep the wording direct, credible, and sales-focused. Do not include hashtags or emojis.',
              ].join(' '),
            },
            {
              role: 'user',
              content: [
                `Product: ${productName}`,
                category ? `Category: ${category}` : null,
                priceLabel ? `Price: ${priceLabel}` : null,
                description ? `Description: ${description.slice(0, 700)}` : null,
                audience ? `Audience: ${audience}` : null,
                purpose === 'product_images' || purpose === 'product_polish' || purpose === 'model_poster' || purpose === 'model_carousel'
                  ? 'Create short product gallery copy for seller reference. The generated images themselves should not need marketing text.'
                  : 'Create ad copy and 2-4 short overlay text options for attractive Facebook, Instagram, TikTok, and X ads.',
              ].filter(Boolean).join('\n'),
            },
          ],
        }),
      });

      if (!copyResponse.ok) {
        const err = await copyResponse.json().catch(() => ({}));
        strapi.log.error('OpenAI marketplace ad copy error:', err);
        return ctx.badRequest('AI ad copy is temporarily unavailable');
      }

      const copyData = await copyResponse.json();
      let parsedCopy = {};
      try {
        parsedCopy = JSON.parse(stripCodeFence(copyData?.choices?.[0]?.message?.content));
      } catch {
        parsedCopy = {};
      }
      const copy = normalizeCreativeCopy(parsedCopy, productName);

      const imagePrompt = purpose === 'model_carousel'
        ? [
          `Create ${count} premium MOVO Marketplace carousel hero image using the attached product photo${modelImage ? ' and model photo' : ''}.`,
          'The first source image is the product reference. Keep the real product recognizable, clear, and large enough for buyers to inspect.',
          modelImage ? 'The second source image is the model reference. If using the model, keep the face, skin tone, hairstyle, and outfit realistic while composing a premium lifestyle advert.' : 'A model is optional for this creative; a product-only enhanced scene is acceptable.',
          `Product: ${productName}.`,
          category ? `Category: ${category}.` : null,
          description ? `Product context: ${description.slice(0, 500)}.` : null,
          posterStyle ? `Desired visual direction: ${posterStyle}.` : null,
          'Design for a wide marketplace carousel/banner crop, with the main product and focal subject centered safely so it still looks good when cover-cropped on mobile. Leave clean space near the top-left for the exact MOVO Marketplace logo overlay and near the lower-left for exact product price text.',
          'Use attractive rich backgrounds such as garden, flowers, ocean graphics, showroom lighting, reflective surfaces, city scenery, marble, soft mist, or premium lifestyle environments. Do not use plain solid color backgrounds.',
          'Do not generate readable text, URLs, prices, badges, or final logos inside the image. The app may add exact branding later.',
          'Avoid distorted faces, duplicate products, wrong labels, fake brand marks, clutter, and low-quality collage edges.',
        ].filter(Boolean).join(' ')
        : purpose === 'model_poster'
        ? [
          `Create ${count} premium vertical MOVO Marketplace fashion/editorial advert poster background images using the attached model photo and product photo.`,
          'The first source image is the product reference. The second source image is the model reference. Keep the same real product recognizable and keep the model face, pose identity, skin tone, hairstyle, and outfit realistic.',
          marketplaceLogo ? 'Use the supplied MOVO Marketplace logo only as brand reference; leave clean space near the top-left for the app to overlay the exact logo later.' : 'Leave clean space near the top-left for a MOVO Marketplace logo overlay.',
          movoBrandsLogo ? 'Use the supplied MOVO Brands logo only as brand reference; leave a clean bottom footer area for the app to overlay exact MOVO Brands branding later.' : 'Leave a clean bottom footer area for MOVO Brands branding.',
          `Product: ${productName}.`,
          category ? `Category: ${category}.` : null,
          description ? `Product context: ${description.slice(0, 500)}.` : null,
          priceLabel ? `The app will overlay this exact price after generation: ${priceLabel}. Leave clean space for it near the lower-left and do not draw the price yourself.` : null,
          posterStyle ? `Desired visual direction: ${posterStyle}.` : null,
          'Compose the model and product like a polished social media advert: the product must be large enough to inspect, placed clearly in the foreground or beside the model, with natural contact shadows and realistic scale.',
          'Each generated poster must have a different attractive background and mood, such as garden, flowers, luxury vanity, ocean-inspired graphics, city night, showroom lighting, marble surface, reflective black surface, soft mist, or elegant scenic backdrop. Do not use plain solid color backgrounds.',
          'Do not generate readable text, URLs, badges, prices, or final logos inside the image. The app will overlay exact branding and footer text after generation.',
          'Avoid distorted faces, extra fingers, duplicate products, wrong product labels, fake brand marks, low-quality collage edges, and cluttered layouts.',
        ].filter(Boolean).join(' ')
        : purpose === 'product_polish'
        ? [
          'Polish and improve the attached seller product photo for an ecommerce marketplace listing.',
          'Preserve the exact product identity, shape, color, labels, logos, materials, and important visible details from the source image.',
          'Improve clarity, sharpness, lighting, white balance, exposure, and noise. Make the product look clean, realistic, and professionally photographed.',
          'If the background is messy, replace it with a clean neutral studio or subtle lifestyle background that does not distract from the product.',
          category ? `Category: ${category}.` : null,
          productName ? `Product name: ${productName}.` : null,
          description ? `Product context: ${description.slice(0, 500)}.` : null,
          'Do not add marketing text, prices, badges, watermarks, UI, fake labels, extra products, or change the product into a different item.',
        ].filter(Boolean).join(' ')
        : purpose === 'product_images'
        ? [
          `Create ${count} distinct ecommerce product gallery images as a varied set from the attached seller product photo.`,
          sourceImage ? 'Keep the same product recognizable and preserve its main shape, color, labels, material, proportions, and important details.' : `The product is: ${productName}.`,
          category ? `Category: ${category}.` : null,
          audience ? `Intended audience: ${audience}.` : null,
          description ? `Product context: ${description.slice(0, 500)}.` : null,
          'Each generated image must use a clearly different product pose, action, camera angle, or presentation. Do not repeat the same side, stance, crop, or plain background across the set.',
          'Use attractive ecommerce graphics and realistic lifestyle scenes, not just flat color studio backgrounds. Include premium visual ideas such as reflective surfaces, water splash, soft smoke or mist, ocean-inspired graphic backgrounds, elegant product pedestals, outdoor use scenes, showroom lighting, or contextual props when they fit the product category.',
          'For vehicles, vary between front view, rear view, three-quarter view, motion on a road, splash of water, and polished mirrored surface scenes. For perfume or beauty items, show spray mist, ocean or floral graphic scenes, luxury vanity surfaces, and close-up hero angles. For clothing, show worn, folded, hanging, and styled outfit views. For food, show serving, packaging, ingredient, and table scenes. For live animals, show natural varied poses and actions such as standing, walking, grazing, front view, side view, and a clean farm or outdoor setting.',
          'The product should remain the main subject and fill the frame enough for buyers to inspect it clearly.',
          'Vary camera angle, crop, product placement, scene, lighting, and background style while keeping the product truthful and recognizable.',
          'Improve the product presentation if the source photo is unclear, but do not invent a different product or alter brand-critical details.',
          'Do not add marketing text, prices, call-to-action buttons, platform UI, logos, watermarks, fake badges, or extra unrelated objects.',
        ].filter(Boolean).join(' ')
        : [
          'Create a polished paid social media product advertisement image.',
          sourceImage ? 'Use the attached product photo as the visual reference and keep the product recognizable.' : `The product is: ${productName}.`,
          category ? `Category: ${category}.` : null,
          audience ? `Audience: ${audience}.` : null,
          description ? `Product context: ${description.slice(0, 500)}.` : null,
          priceLabel ? `Include price cue if it fits naturally: ${priceLabel}.` : null,
          'Use clean premium composition, realistic lighting, modern ecommerce styling, and readable marketing typography.',
          `Include one of these short text overlays: ${copy.overlayTexts.join(' | ')}.`,
          `Call to action: ${copy.callToAction}.`,
          'Avoid clutter, tiny text, distorted product shapes, fake platform UI, celebrity likenesses, and third-party logos unless they are already on the product.',
        ].filter(Boolean).join(' ');

      const imageForm = new FormData();
      const imageModel = purpose === 'ad_creatives' || purpose === 'model_poster' || purpose === 'model_carousel' ? 'gpt-image-1' : 'gpt-image-1-mini';
      imageForm.append('model', imageModel);
      imageForm.append('prompt', imagePrompt);
      imageForm.append('n', String(purpose === 'product_polish' ? 1 : count));
      imageForm.append('size', purpose === 'model_poster' ? '1024x1536' : purpose === 'model_carousel' ? '1536x1024' : '1024x1024');
      imageForm.append('quality', purpose === 'ad_creatives' ? 'medium' : 'high');

      const sourceImages = [sourceImage, modelImage, marketplaceLogo, movoBrandsLogo].filter(Boolean);
      const imageEndpoint = sourceImages.length
        ? 'https://api.openai.com/v1/images/edits'
        : 'https://api.openai.com/v1/images/generations';

      if (sourceImages.length === 1) {
        imageForm.append('image', new Blob([sourceImage.buffer], { type: sourceImage.mime }), sourceImage.filename);
      } else if (sourceImages.length > 1) {
        sourceImages.forEach((image, index) => {
          imageForm.append('image[]', new Blob([image.buffer], { type: image.mime }), image.filename || `poster-source-${index + 1}.png`);
        });
      }

      const imageResponse = await fetch(imageEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: imageForm,
      });

      if (!imageResponse.ok) {
        const err = await imageResponse.json().catch(() => ({}));
        strapi.log.error('OpenAI marketplace ad image error:', err);
        return ctx.badRequest(err?.error?.message || 'AI image generation is temporarily unavailable');
      }

      const imageData = await imageResponse.json();
      const creatives = (Array.isArray(imageData?.data) ? imageData.data : [])
        .map(/** @param {any} item @param {number} index */(item, index) => ({
          id: `${Date.now()}_${index}`,
          format: 'square_feed',
          imageDataUrl: item?.b64_json ? `data:image/png;base64,${item.b64_json}` : '',
          imageUrl: item?.url || '',
          headline: copy.headline,
          primaryText: copy.primaryText,
          description: copy.description,
          callToAction: copy.callToAction,
          purpose,
        }))
        .filter(/** @param {{ imageDataUrl?: string, imageUrl?: string }} item */(item) => item.imageDataUrl || item.imageUrl);

      if (!creatives.length) {
        return ctx.badRequest('AI image generation returned no images');
      }

      return {
        data: {
          copy,
          creatives,
          source: sourceImages.length ? 'uploaded_or_product_image' : 'text_prompt',
          purpose,
        },
      };
    } catch (err) {
      strapi.log.error('OpenAI marketplace ad creative exception:', err);
      return ctx.badRequest('AI ad creative generation is temporarily unavailable');
    }
  },
};
