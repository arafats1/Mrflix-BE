'use strict';

/**
 * AI Movie Assistant Controller
 * Uses OpenAI to help users discover movies based on natural language queries
 */
module.exports = {
  async chat(ctx) {
    const { message, history } = ctx.request.body;

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
      // Fetch all available movies for context
      const movies = await strapi.entityService.findMany('api::movie.movie', {
        filters: { isAvailable: true },
        fields: ['title', 'overview', 'genres', 'type', 'rating', 'releaseDate', 'countryOfOrigin', 'priceUGX', 'seasons', 'trailerUrl'],
        sort: 'createdAt:desc',
        limit: 200,
      });

      // Build movie catalog summary
      const catalog = movies.map(m => {
        const parts = [`"${m.title}" (${m.type})`];
        if (m.genres?.length) parts.push(`Genres: ${Array.isArray(m.genres) ? m.genres.join(', ') : m.genres}`);
        if (m.rating) parts.push(`Rating: ${m.rating}/10`);
        if (m.releaseDate) parts.push(`Released: ${m.releaseDate}`);
        if (m.countryOfOrigin) parts.push(`Country: ${m.countryOfOrigin}`);
        if (m.type === 'series' && m.seasons) parts.push(`${m.seasons} seasons`);
        if (m.overview) parts.push(`Plot: ${m.overview.substring(0, 150)}`);
        return parts.join(' | ');
      }).join('\n');

      const systemPrompt = `You are Mr.Flix AI, a friendly and knowledgeable movie assistant for the Mr.Flix streaming platform in Uganda. You help users discover movies and series from our catalog.

IMPORTANT RULES:
- Only recommend movies/series that exist in our catalog below
- If a user asks for something not in our catalog, politely say it's not available yet. Mention the exact title they asked for so they know. Then say: "Would you like me to submit a request to have it added? Just say yes and I'll handle it for you!"
- Be conversational, fun, and brief (2-4 sentences per recommendation)
- When recommending, mention the title, genre, and a brief why they'd enjoy it
- You can recommend up to 5 movies at a time
- If the user's request is vague, ask a clarifying question
- You understand natural language like "something funny", "a movie like John Wick", "Korean drama", "something to watch with family"
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
      const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response. Please try again.';

      // Extract mentioned movie titles for linking
      const mentionedMovies = movies.filter(m =>
        reply.toLowerCase().includes(m.title.toLowerCase())
      ).map(m => ({
        id: m.documentId || m.id,
        title: m.title,
        type: m.type,
        trailerUrl: m.trailerUrl || null,
      }));

      // Detect if the AI is suggesting a movie request (movie not in catalog)
      const replyLower = reply.toLowerCase();
      const suggestsRequest = (
        replyLower.includes('not available') ||
        replyLower.includes('not in our catalog') ||
        replyLower.includes("isn't available") ||
        replyLower.includes("don't have") ||
        replyLower.includes('submit a request') ||
        replyLower.includes('request to have it')
      );

      // Detect if the AI is asking for name/WhatsApp (user said yes to request)
      const collectingInfo = (
        replyLower.includes('whatsapp number') ||
        replyLower.includes('whatsapp') && replyLower.includes('notify you')
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
