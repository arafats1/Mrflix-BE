'use strict';

/**
 * Coming Soon Controller
 * Fetches upcoming movies from TMDB API
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';

// Genre ID → name mapping from TMDB
const GENRE_MAP = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
  80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};

module.exports = {
  async find(ctx) {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;

    if (!TMDB_API_KEY) {
      // If no TMDB key, return empty
      return { data: [] };
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      // Fetch upcoming movies (released in the future)
      const url = `${TMDB_BASE}/movie/upcoming?api_key=${TMDB_API_KEY}&language=en-US&page=1&region=US`;

      const response = await fetch(url);
      if (!response.ok) {
        strapi.log.error('TMDB API error:', response.status);
        return { data: [] };
      }

      const data = await response.json();

      // Filter to only future releases and transform
      const movies = (data.results || [])
        .filter(m => m.release_date && m.release_date > today)
        .slice(0, 12)
        .map(m => ({
          id: m.id,
          title: m.title,
          overview: m.overview || '',
          posterPath: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
          backdropPath: m.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : null,
          releaseDate: m.release_date,
          rating: m.vote_average || 0,
          genres: (m.genre_ids || []).map(gid => GENRE_MAP[gid] || 'Other').filter(Boolean),
          type: 'movie',
        }));

      return { data: movies };
    } catch (err) {
      strapi.log.error('Coming soon fetch error:', err);
      return { data: [] };
    }
  },
};
