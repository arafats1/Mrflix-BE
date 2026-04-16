'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::search-history.search-history', ({ strapi }) => ({
  // Public endpoint — anyone can log a search (no auth required)
  async create(ctx) {
    const { query, platform, resultsCount, userId, userName } = ctx.request.body?.data || ctx.request.body || {};

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return ctx.badRequest('Search query must be at least 2 characters');
    }

    const sanitizedQuery = query.trim().substring(0, 200);
    const sanitizedPlatform = ['web', 'mobile', 'tv', 'mobile-luganda', 'tv-luganda'].includes(platform) ? platform : 'web';

    const entry = await strapi.documents('api::search-history.search-history').create({
      data: {
        query: sanitizedQuery,
        platform: sanitizedPlatform,
        resultsCount: Math.max(0, parseInt(resultsCount) || 0),
        userId: userId ? parseInt(userId) : null,
        userName: userName ? String(userName).substring(0, 100) : null,
      },
      status: 'published',
    });

    return { data: { id: entry.id } };
  },

  // Admin-only: get search history with aggregation stats
  async find(ctx) {
    // Check admin
    if (!ctx.state.user || (ctx.state.user.role?.type !== 'admin' && ctx.state.user.role?.name !== 'Admin')) {
      return ctx.unauthorized('Admin access required');
    }

    const { search, platform, noResults, page = 1, pageSize = 50 } = ctx.query;

    const filters = {};
    if (search) filters.query = { $containsi: search };
    if (platform && platform !== 'all') filters.platform = { $eq: platform };
    if (noResults === 'true') filters.resultsCount = { $eq: 0 };

    const entries = await strapi.documents('api::search-history.search-history').findMany({
      filters,
      sort: 'createdAt:desc',
      limit: parseInt(pageSize),
      start: (parseInt(page) - 1) * parseInt(pageSize),
    });

    const count = await strapi.documents('api::search-history.search-history').count({ filters });

    return {
      data: entries,
      meta: {
        pagination: {
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          pageCount: Math.ceil(count / parseInt(pageSize)),
          total: count,
        },
      },
    };
  },

  // Admin-only: aggregated stats — top searches, zero-result searches
  async stats(ctx) {
    if (!ctx.state.user || (ctx.state.user.role?.type !== 'admin' && ctx.state.user.role?.name !== 'Admin')) {
      return ctx.unauthorized('Admin access required');
    }

    // Get all searches (up to 10000 for aggregation)
    const allSearches = await strapi.documents('api::search-history.search-history').findMany({
      sort: 'createdAt:desc',
      limit: 10000,
    });

    // Aggregate by query (case-insensitive)
    const queryMap = {};
    let totalSearches = 0;
    let zeroResultSearches = 0;

    for (const s of allSearches) {
      totalSearches++;
      const key = s.query.toLowerCase().trim();
      if (!queryMap[key]) {
        queryMap[key] = {
          query: s.query,
          count: 0,
          zeroResults: 0,
          platforms: new Set(),
          lastSearched: s.createdAt,
        };
      }
      queryMap[key].count++;
      if (s.resultsCount === 0) {
        queryMap[key].zeroResults++;
        zeroResultSearches++;
      }
      queryMap[key].platforms.add(s.platform);
    }

    // Convert to arrays, sorted by count
    const topSearches = Object.values(queryMap)
      .map(q => ({ ...q, platforms: [...q.platforms] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    const zeroResultQueries = Object.values(queryMap)
      .filter(q => q.zeroResults > 0)
      .map(q => ({ ...q, platforms: [...q.platforms] }))
      .sort((a, b) => b.zeroResults - a.zeroResults)
      .slice(0, 50);

    return {
      data: {
        totalSearches,
        zeroResultSearches,
        uniqueQueries: Object.keys(queryMap).length,
        topSearches,
        zeroResultQueries,
      },
    };
  },

  // Admin-only: clear old search history
  async clear(ctx) {
    if (!ctx.state.user || (ctx.state.user.role?.type !== 'admin' && ctx.state.user.role?.name !== 'Admin')) {
      return ctx.unauthorized('Admin access required');
    }

    const allEntries = await strapi.documents('api::search-history.search-history').findMany({ limit: 100000 });
    for (const entry of allEntries) {
      await strapi.documents('api::search-history.search-history').delete({ documentId: entry.documentId });
    }

    return { data: { cleared: allEntries.length } };
  },
}));
