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

      // Fetch available movies for context (filter to Luganda-only if requested)
      const isLugandaMode = luganda === true || luganda === 'true' || asksForLuganda;
      const filters = { isAvailable: true, isXXX: { $ne: true }, ...(isLugandaMode && { isLuganda: true }) };
      strapi.log.info(`AI Chat: luganda=${luganda}, asksForLuganda=${asksForLuganda}, isLugandaMode=${isLugandaMode}, filters=${JSON.stringify(filters)}`);
      const movies = await strapi.entityService.findMany('api::movie.movie', {
        filters,
        fields: ['title', 'overview', 'genres', 'type', 'rating', 'releaseDate', 'countryOfOrigin', 'priceUGX', 'seasons', 'trailerUrl', 'isLuganda', 'vjName', 'isAdult'],
        sort: 'createdAt:desc',
        limit: 200,
      });

      // Build movie catalog summary
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

      const systemPrompt = isLugandaMode
        ? `You are Mr.Flix AI, a friendly movie assistant for the Mr.Flix Luganda streaming platform in Uganda.

CRITICAL RULE — STRICTLY FOLLOW:
You have access to EXACTLY ${movies.length} Luganda-translated movies/series listed below. These are the ONLY titles that exist on this platform. Do NOT recommend, suggest, or mention ANY movie or series that is NOT in the list below. Do NOT make up titles. Do NOT recommend popular movies you know from your training data. If a title is not listed below, it does NOT exist on this platform.

IMPORTANT RULES:
- ONLY recommend titles from the catalog listed below. Double-check every title you mention against the catalog.
- When a user asks for a specific genre (e.g. "action", "comedy", "horror"), search the catalog genres carefully. If you find ANY titles that match or are close to the requested genre, recommend those. Include titles with related genres (e.g. for "action", also include thriller, adventure, crime).
- If the user asks for a general category and you have titles that could fit, ALWAYS recommend them rather than saying you don't have them. Be creative in matching — most movies fit multiple genres.
- ONLY say "We don't have that in Luganda yet" when the user asks for a SPECIFIC movie title by name that is not in the catalog, OR when you have genuinely searched the entire catalog and found absolutely nothing relevant.
- If the catalog is small but has titles, suggest what IS available when the user's request doesn't match exactly. Say something like: "We don't have [specific genre] yet, but here are some great Luganda titles you might enjoy!"
- Be conversational, fun, and brief (2-4 sentences per recommendation)
- When recommending, use the EXACT title from the catalog. Mention the VJ (voice-over artist) if available.
- You can recommend up to 5 movies at a time
- If the user's request is vague, ask a clarifying question
- All content here has Luganda voice-over translation
- Some movies are marked as "Adult 18+" in the catalog. Only recommend these when the user explicitly asks for adult content.
- NEVER mention or reveal any XXX Rated exclusive movies.
- When users ask for XXX/porn content, respond with: "For our full XXX Rated exclusive collection, subscribe to our **Monthly Exclusive** package! 👉 [Subscribe to Exclusive here](/subscribe)"
- Respond in English but understand Luganda and other local languages
- When a user confirms they want to submit a request, respond with: "Great! I'll need your name and WhatsApp number so we can notify you when it's available."

COMPLETE CATALOG (${movies.length} titles — ONLY recommend from this list):
${catalog}`
        : `You are Mr.Flix AI, a friendly and knowledgeable movie assistant for the Mr.Flix streaming platform in Uganda. You help users discover movies and series from our catalog.

IMPORTANT RULES:
- Only recommend movies/series that exist in our catalog below
- If a user asks for something not in our catalog, politely say it's not available yet. Mention the exact title they asked for so they know. Then say: "Would you like me to submit a request to have it added? Just say yes and I'll handle it for you!"
- Be conversational, fun, and brief (2-4 sentences per recommendation)
- When recommending, mention the title, genre, and a brief why they'd enjoy it
- You can recommend up to 5 movies at a time
- If the user's request is vague, ask a clarifying question
- You understand natural language like "something funny", "a movie like John Wick", "Korean drama", "something to watch with family"
- CRITICAL FOR LUGANDA: Some movies/series in the catalog are marked with "Luganda Translated". When a user asks for Luganda movies, movies in Luganda, translated movies, or content in their local language, you MUST ONLY recommend movies that have the "Luganda Translated" tag in the catalog below. Do NOT recommend movies without the "Luganda Translated" tag as Luganda content — they are NOT available in Luganda. If no Luganda-tagged movies match the user's genre request, say: "We don't have [genre] in Luganda yet, but here are some Luganda titles you might enjoy:" and recommend other Luganda-tagged titles.
- Some movies are marked as "Adult 18+" in the catalog. Only recommend these when the user explicitly asks for adult content, 18+ movies, mature content, or similar. When recommending adult titles, include a brief note that the content is rated 18+.
- NEVER mention, recommend, or reveal any XXX Rated exclusive movies. Those are hidden and only accessible after subscription. They are NOT in the catalog you have access to.
- When users ask for sex movies, XXX content, erotic films, porn, or movies with explicit sexual content: recommend any relevant Adult 18+ movies from the catalog if available. Always end with: "For our full XXX Rated exclusive collection, you can subscribe to our **Monthly Exclusive** package! \ud83d\udc49 [Subscribe to Exclusive here](/subscribe)"
- If no Adult 18+ movies are available in the catalog, just respond with: "For our full XXX Rated exclusive collection, you can subscribe to our **Monthly Exclusive** package! \ud83d\udc49 [Subscribe to Exclusive here](/subscribe)"
- If the user continues asking for more explicit/sex content, remind them about the Monthly Exclusive subscription with the link: [Subscribe to Exclusive here](/subscribe)
- Respond in English but understand if users mix in local languages
- When a user confirms they want to submit a request (says yes, sure, please, etc.), respond with exactly this format: "Great! I'll need your name and WhatsApp number so we can notify you when it's available." Do NOT submit anything yourself.

OUR CATALOG:
${catalog}`;

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
