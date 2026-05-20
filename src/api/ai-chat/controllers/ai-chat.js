'use strict';

/**
 * AI Movie Assistant Controller
 * Uses OpenAI to help users discover movies based on natural language queries
 */
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
      const safe = async (p) => {
        try { return await p; } catch (e) { strapi.log.warn('AI Chat fetch failed:', e?.message || e); return []; }
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
          filters: { status: 'active' },
          fields: ['title', 'company', 'jobFunction', 'industry', 'experienceLevel', 'location', 'jobType', 'salary'],
          sort: 'createdAt:desc',
          limit: 30,
        })),
        safe(strapi.entityService.findMany('api::entrep-course.entrep-course', {
          filters: { status: 'published' },
          fields: ['title', 'shortDescription', 'category', 'level', 'durationWeeks', 'priceUGX', 'providerName'],
          sort: 'createdAt:desc',
          limit: 30,
        })),
        safe(strapi.entityService.findMany('api::provider-material.provider-material', {
          filters: { status: 'approved' },
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
};
