'use strict';

const movies = [
  {
    title: "Black Panther",
    tmdbId: 284054,
    overview: "King T'Challa returns home to the reclusive, technologically advanced African nation of Wakanda to serve as his country's new leader.",
    posterUrl: "https://image.tmdb.org/t/p/w500/uxzzxijgPIY7slzFvMotPv8wjKA.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/b6ZJZHUdMEFECvGiDpJjlfUWela.jpg",
    releaseDate: "2018-02-13",
    rating: 7.4,
    genres: ["Action", "Adventure", "Science Fiction"],
    type: "movie",
    priceUGX: 2000,
    trailerUrl: "https://www.youtube.com/embed/xjDjIWPwcPU",
    isAvailable: true,
    isFeatured: true,
    isTrending: true,
  },
  {
    title: "Black Panther: Wakanda Forever",
    tmdbId: 505642,
    overview: "Queen Ramonda, Shuri, M'Baku, Okoye and the Dora Milaje fight to protect their nation from intervening world powers in the wake of King T'Challa's death.",
    posterUrl: "https://image.tmdb.org/t/p/w500/sv1xJUazXeYqALzczSZ3O6nkH75.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/xDMIl84Qo5Tsu62c9DGWhmPI67A.jpg",
    releaseDate: "2022-11-09",
    rating: 6.7,
    genres: ["Action", "Adventure", "Science Fiction"],
    type: "movie",
    priceUGX: 2000,
    trailerUrl: "https://www.youtube.com/embed/_Z3QKkl1WyM",
    isAvailable: true,
    isFeatured: false,
  },
  {
    title: "Oppenheimer",
    tmdbId: 872585,
    overview: "The story of J. Robert Oppenheimer's role in the development of the atomic bomb during World War II.",
    posterUrl: "https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg",
    releaseDate: "2023-07-19",
    rating: 8.1,
    genres: ["Drama", "History"],
    type: "movie",
    priceUGX: 2000,
    trailerUrl: "https://www.youtube.com/embed/uYPbbksJxIg",
    isAvailable: true,
    isFeatured: true,
    isTrending: true,
  },
  {
    title: "Dune",
    tmdbId: 438631,
    overview: "Paul Atreides must travel to the most dangerous planet in the universe to ensure the future of his family and his people.",
    posterUrl: "https://image.tmdb.org/t/p/w500/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/jYEW5xZkZk2WTrdbMGAPm0HBTGc.jpg",
    releaseDate: "2021-09-15",
    rating: 7.8,
    genres: ["Science Fiction", "Adventure"],
    type: "movie",
    priceUGX: 2000,
    trailerUrl: "https://www.youtube.com/embed/8g18jFHCLXk",
    isAvailable: true,
    isFeatured: false,
    isTrending: true,
  },
  {
    title: "Extraction 2",
    tmdbId: 646385,
    overview: "Back from the brink of death, highly skilled commando Tyler Rake takes on another dangerous mission.",
    posterUrl: "https://image.tmdb.org/t/p/w500/7gKI9hpEMcZUQpNgKrkDzJpbnNS.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/qVygtf2vU15L2BKnUFT7VaagJ5Z.jpg",
    releaseDate: "2023-06-09",
    rating: 7.1,
    genres: ["Action", "Thriller"],
    type: "movie",
    priceUGX: 2000,
    trailerUrl: "https://www.youtube.com/embed/Y274jZs5s7s",
    isAvailable: true,
    isFeatured: false,
  },
  {
    title: "Deadpool & Wolverine",
    tmdbId: 533535,
    overview: "A listless Wade Wilson toils away in civilian life. But when his homeworld faces an existential threat, Wade must reluctantly suit up again.",
    posterUrl: "https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/yDHYTfA3R0jFYba16jBB1ef8oIt.jpg",
    releaseDate: "2024-07-24",
    rating: 7.7,
    genres: ["Action", "Comedy", "Science Fiction"],
    type: "movie",
    priceUGX: 2000,
    trailerUrl: "https://www.youtube.com/embed/73_1biulkYk",
    isAvailable: true,
    isFeatured: true,
    isTrending: true,
  },
  {
    title: "Money Heist",
    tmdbId: 71446,
    overview: "To carry out the biggest heist in history, a mysterious man called The Professor recruits a band of eight robbers.",
    posterUrl: "https://image.tmdb.org/t/p/w500/reEMJA1uzscCbkpeRJeTT2bjqUp.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/gFZriCkpJYsApPZEF3jhxL4yLzG.jpg",
    releaseDate: "2017-05-02",
    rating: 8.3,
    genres: ["Crime", "Drama"],
    type: "series",
    seasons: 5,
    priceUGX: 5000,
    trailerUrl: "https://www.youtube.com/embed/hMbhKGmHThE",
    isAvailable: true,
    isFeatured: true,
    isTrending: true,
  },
  {
    title: "Squid Game",
    tmdbId: 93405,
    overview: "Hundreds of cash-strapped players accept a strange invitation to compete in children's games with deadly high stakes.",
    posterUrl: "https://image.tmdb.org/t/p/w500/dDlEmu3EZ0Pgg93K2SVNLCjCSvE.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/oaGvjB0DvdhXhOAuADfHb261ZHa.jpg",
    releaseDate: "2021-09-17",
    rating: 7.8,
    genres: ["Action", "Drama", "Mystery"],
    type: "series",
    seasons: 2,
    priceUGX: 5000,
    trailerUrl: "https://www.youtube.com/embed/oqxAJKy0ii4",
    isAvailable: true,
    isFeatured: false,
    isTrending: true,
  },
  {
    title: "Breaking Bad",
    tmdbId: 1396,
    overview: "A chemistry teacher diagnosed with cancer enters the dangerous world of drugs and crime to secure his family's future.",
    posterUrl: "https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg",
    releaseDate: "2008-01-20",
    rating: 8.9,
    genres: ["Drama", "Crime", "Thriller"],
    type: "series",
    seasons: 5,
    priceUGX: 5000,
    trailerUrl: "https://www.youtube.com/embed/HhesaQXLuRY",
    isAvailable: true,
    isFeatured: false,
  },
  {
    title: "The Woman King",
    tmdbId: 786892,
    overview: "The story of the Agojie, the all-female unit of warriors who protected the African Kingdom of Dahomey in the 1800s.",
    posterUrl: "https://image.tmdb.org/t/p/w500/438QXt1E3WJWb3PqNniK0tAE5c1.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/7zQJYV02yehWrQN6NjVRB5FMFqA.jpg",
    releaseDate: "2022-09-15",
    rating: 6.8,
    genres: ["Action", "Drama", "History"],
    type: "movie",
    priceUGX: 2000,
    trailerUrl: "https://www.youtube.com/embed/3RDaPV_rJ1Y",
    isAvailable: true,
    isFeatured: false,
  },
  {
    title: "Barbie",
    tmdbId: 346698,
    overview: "Barbie and Ken discover the joys and perils of living among humans when they get a chance to visit the real world.",
    posterUrl: "https://image.tmdb.org/t/p/w500/iuFNMS8U5cb6xfzi51Dbkovj7vM.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/nHf61UzkfFno5X1ofIhugCPus2R.jpg",
    releaseDate: "2023-07-19",
    rating: 7.0,
    genres: ["Comedy", "Adventure", "Fantasy"],
    type: "movie",
    priceUGX: 2000,
    trailerUrl: "https://www.youtube.com/embed/pBk4NYhWNMM",
    isAvailable: true,
    isFeatured: false,
  },
  {
    title: "The Last of Us",
    tmdbId: 100088,
    overview: "Twenty years after civilization's collapse, Joel smuggles Ellie out of a quarantine zone on a brutal, heartbreaking journey.",
    posterUrl: "https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg",
    backdropUrl: "https://image.tmdb.org/t/p/original/uDgy6hyPd82kOHh6I95FLtLnj6p.jpg",
    releaseDate: "2023-01-15",
    rating: 8.6,
    genres: ["Drama", "Sci-Fi & Fantasy", "Action"],
    type: "series",
    seasons: 2,
    priceUGX: 5000,
    trailerUrl: "https://www.youtube.com/embed/uLtkt8BonwM",
    isAvailable: true,
    isFeatured: true,
    isTrending: true,
  },
];

module.exports = {
  register(/*{ strapi }*/) {},

  async bootstrap({ strapi }) {
    // Disable email confirmation requirement so users can login immediately
    const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' });
    const advancedSettings = await pluginStore.get({ key: 'advanced' });
    if (advancedSettings && advancedSettings.email_confirmation) {
      advancedSettings.email_confirmation = false;
      await pluginStore.set({ key: 'advanced', value: advancedSettings });
      console.log('📧 Disabled email confirmation requirement');
    }

    // Confirm any existing unconfirmed users
    const unconfirmedUsers = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { confirmed: false },
    });
    for (const u of unconfirmedUsers) {
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: u.id },
        data: { confirmed: true },
      });
      console.log(`  ✅ Confirmed user: ${u.email}`);
    }

    // Seed movies if none exist
    const existingMovies = await strapi.documents('api::movie.movie').findMany({
      limit: 1,
    });

    if (!existingMovies || existingMovies.length === 0) {
      console.log('🎬 Seeding Mr.Flix movie catalog...');
      for (const movie of movies) {
        try {
          await strapi.documents('api::movie.movie').create({
            data: movie,
            status: 'published',
          });
          console.log(`  ✅ Added: ${movie.title}`);
        } catch (err) {
          console.error(`  ❌ Failed: ${movie.title}`, err.message);
        }
      }
      console.log(`✅ Seeded ${movies.length} movies/series`);
    } else {
      console.log('🎬 Movie catalog already seeded, skipping...');
    }

    // Configure public API permissions automatically
    try {
      const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { type: 'public' },
      });

      if (publicRole) {
        const publicPermissions = [
          // Movies - public can find and findOne
          { action: 'api::movie.movie.find' },
          { action: 'api::movie.movie.findOne' },
          // Site settings - public can read pricing
          { action: 'api::site-setting.site-setting.find' },
          // Auth - public can register, login, callback
          { action: 'plugin::users-permissions.auth.callback' },
          { action: 'plugin::users-permissions.auth.connect' },
          { action: 'plugin::users-permissions.auth.register' },
        ];

        for (const perm of publicPermissions) {
          const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
            where: { action: perm.action, role: publicRole.id },
          });
          if (!existing) {
            await strapi.db.query('plugin::users-permissions.permission').create({
              data: { action: perm.action, role: publicRole.id, enabled: true },
            });
          }
        }
        console.log('🔓 Public API permissions configured');
      }

      // Configure authenticated user permissions
      const authRole = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { type: 'authenticated' },
      });

      if (authRole) {
        const authPermissions = [
          // Movies
          { action: 'api::movie.movie.find' },
          { action: 'api::movie.movie.findOne' },
          // Purchases
          { action: 'api::purchase.purchase.find' },
          { action: 'api::purchase.purchase.findOne' },
          { action: 'api::purchase.purchase.create' },
          // Subscriptions
          { action: 'api::subscription.subscription.find' },
          { action: 'api::subscription.subscription.findOne' },
          { action: 'api::subscription.subscription.create' },
          // Site settings (read-only)
          { action: 'api::site-setting.site-setting.find' },
          // Movie Requests
          { action: 'api::movie-request.movie-request.find' },
          { action: 'api::movie-request.movie-request.findOne' },
          { action: 'api::movie-request.movie-request.create' },
          { action: 'api::movie-request.movie-request.update' },
          // Free Trial
          { action: 'api::free-trial-watch.free-trial-watch.myStatus' },
          { action: 'api::free-trial-watch.free-trial-watch.record' },
          { action: 'api::free-trial-watch.free-trial-watch.canWatch' },
          // User profile
          { action: 'plugin::users-permissions.user.me' },
          { action: 'plugin::users-permissions.auth.callback' },
          { action: 'plugin::users-permissions.auth.connect' },
        ];

        for (const perm of authPermissions) {
          const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
            where: { action: perm.action, role: authRole.id },
          });
          if (!existing) {
            await strapi.db.query('plugin::users-permissions.permission').create({
              data: { action: perm.action, role: authRole.id, enabled: true },
            });
          }
        }
        console.log('🔐 Authenticated API permissions configured');
      }

      // Create Admin role for frontend admins (users-permissions)
      let adminRole = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { type: 'admin' },
      });

      if (!adminRole) {
        adminRole = await strapi.db.query('plugin::users-permissions.role').create({
          data: {
            name: 'Admin',
            description: 'Admin users who can manage movies, purchases, and requests',
            type: 'admin',
          },
        });
        console.log('👑 Created Admin role for users-permissions');
      }

      if (adminRole) {
        const adminPermissions = [
          // Full movie CRUD
          { action: 'api::movie.movie.find' },
          { action: 'api::movie.movie.findOne' },
          { action: 'api::movie.movie.create' },
          { action: 'api::movie.movie.update' },
          { action: 'api::movie.movie.delete' },
          // Full purchase access
          { action: 'api::purchase.purchase.find' },
          { action: 'api::purchase.purchase.findOne' },
          { action: 'api::purchase.purchase.create' },
          { action: 'api::purchase.purchase.update' },
          // Full subscription access
          { action: 'api::subscription.subscription.find' },
          { action: 'api::subscription.subscription.findOne' },
          { action: 'api::subscription.subscription.create' },
          { action: 'api::subscription.subscription.update' },
          { action: 'api::subscription.subscription.delete' },
          // Site settings (full access)
          { action: 'api::site-setting.site-setting.find' },
          { action: 'api::site-setting.site-setting.createOrUpdate' },
          // Full request access
          { action: 'api::movie-request.movie-request.find' },
          { action: 'api::movie-request.movie-request.findOne' },
          { action: 'api::movie-request.movie-request.create' },
          { action: 'api::movie-request.movie-request.update' },
          { action: 'api::movie-request.movie-request.delete' },
          // Free Trial
          { action: 'api::free-trial-watch.free-trial-watch.myStatus' },
          { action: 'api::free-trial-watch.free-trial-watch.record' },
          { action: 'api::free-trial-watch.free-trial-watch.canWatch' },
          { action: 'api::free-trial-watch.free-trial-watch.find' },
          { action: 'api::free-trial-watch.free-trial-watch.delete' },
          // User management
          { action: 'plugin::users-permissions.user.me' },
          { action: 'plugin::users-permissions.user.find' },
          { action: 'plugin::users-permissions.user.findOne' },
          { action: 'plugin::users-permissions.user.count' },
          { action: 'plugin::users-permissions.auth.callback' },
          { action: 'plugin::users-permissions.auth.connect' },
          // Upload
          { action: 'plugin::upload.content-api.upload' },
          { action: 'plugin::upload.content-api.find' },
        ];

        for (const perm of adminPermissions) {
          const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
            where: { action: perm.action, role: adminRole.id },
          });
          if (!existing) {
            await strapi.db.query('plugin::users-permissions.permission').create({
              data: { action: perm.action, role: adminRole.id, enabled: true },
            });
          }
        }
        console.log('👑 Admin API permissions configured');
      }
    } catch (err) {
      console.error('⚠️ Failed to set permissions:', err.message);
    }
  },
};
