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
  register({ strapi }) {
    // Trust Railway/Render reverse proxy so secure cookies work behind HTTPS termination
    if (process.env.TRUST_PROXY === 'true') {
      strapi.server.app.proxy = true;
    }
  },

  async bootstrap({ strapi }) {
    // ── Register Pesapal IPN URL ──
    try {
      const pesapal = require('./utils/pesapal');
      const backendUrl = process.env.PUBLIC_URL || '';
      const ipnUrl = `${backendUrl}/api/pesapal/ipn`;
      const ipnId = await pesapal.registerIPN(ipnUrl);

      // Save IPN ID in site settings so controllers can use it
      const existing = await strapi.entityService.findMany('api::site-setting.site-setting');
      if (existing?.id) {
        await strapi.entityService.update('api::site-setting.site-setting', existing.id, {
          data: { pesapalIpnId: ipnId },
        });
      } else {
        await strapi.entityService.create('api::site-setting.site-setting', {
          data: { pesapalIpnId: ipnId },
        });
      }
    } catch (err) {
      // Pesapal IPN registration failed
      // Payments will NOT work until Pesapal keys are configured.
    }

    // Disable email confirmation requirement so users can login immediately
    const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' });
    const advancedSettings = await pluginStore.get({ key: 'advanced' });
    if (advancedSettings && advancedSettings.email_confirmation) {
      advancedSettings.email_confirmation = false;
      await pluginStore.set({ key: 'advanced', value: advancedSettings });
    }

    // Configure Google OAuth provider if credentials are set
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      try {
        const grantConfig = await pluginStore.get({ key: 'grant' });
        if (grantConfig) {
          grantConfig.google = {
            enabled: true,
            icon: 'google',
            key: process.env.GOOGLE_CLIENT_ID,
            secret: process.env.GOOGLE_CLIENT_SECRET,
            callback: process.env.GOOGLE_REDIRECT_URL || 'https://www.mrflix.app/auth/google/callback',
            scope: ['email', 'profile'],
          };
          await pluginStore.set({ key: 'grant', value: grantConfig });
        }
      } catch (err) {
        // Google OAuth config failed
      }
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
    }

    // Seed movies if none exist
    const existingMovies = await strapi.documents('api::movie.movie').findMany({
      limit: 1,
    });

    if (!existingMovies || existingMovies.length === 0) {
      for (const movie of movies) {
        try {
          await strapi.documents('api::movie.movie').create({
            data: movie,
            status: 'published',
          });
        } catch (err) {
          // Movie creation failed
        }
      }
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
          // Music - public can browse the catalog (gating happens client-side
          // by isExclusive + age + religion)
          { action: 'api::music.music.find' },
          { action: 'api::music.music.findOne' },
          // Site settings - public can read pricing
          { action: 'api::site-setting.site-setting.find' },
          // Auth - public can register, login, callback
          { action: 'plugin::users-permissions.auth.callback' },
          { action: 'plugin::users-permissions.auth.connect' },
          { action: 'plugin::users-permissions.auth.register' },
          // Pesapal IPN - called by Pesapal servers
          { action: 'api::pesapal-webhook.pesapal-webhook.ipn' },
          { action: 'api::pesapal-webhook.pesapal-webhook.verify' },
          // Contact messages - anyone can submit
          { action: 'api::contact-message.contact-message.create' },
          // MrKeyp shared links - public access
          { action: 'api::shared-link.shared-link.access' },
          { action: 'api::account-invitation.account-invitation.preview' },
          // MrKeyp storage pricing - public
          { action: 'api::storage-subscription.storage-subscription.pricing' },
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
          { action: 'api::purchase.purchase.createBulk' },
          { action: 'api::purchase.purchase.checkStatus' },
          { action: 'api::purchase.purchase.incrementDownload' },
          // Subscriptions
          { action: 'api::subscription.subscription.find' },
          { action: 'api::subscription.subscription.findOne' },
          { action: 'api::subscription.subscription.create' },
          { action: 'api::subscription.subscription.me' },
          { action: 'api::subscription.subscription.checkStatus' },
          { action: 'api::subscription.subscription.incrementDownload' },
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
          // Active Streaming
          { action: 'api::active-stream.active-stream.heartbeat' },
          { action: 'api::active-stream.active-stream.stop' },
          { action: 'api::active-stream.active-stream.parentHistory' },
          // Contact messages
          { action: 'api::contact-message.contact-message.create' },
          // User profile
          { action: 'plugin::users-permissions.user.me' },
          { action: 'plugin::users-permissions.auth.callback' },
          { action: 'plugin::users-permissions.auth.connect' },
          // Child profiles (parent-only enforcement happens in controller)
          { action: 'api::child-profile.child-profile.mine' },
          { action: 'api::child-profile.child-profile.create' },
          { action: 'api::child-profile.child-profile.update' },
          { action: 'api::child-profile.child-profile.delete' },
          { action: 'api::child-profile.child-profile.toggleBlock' },
          // Music
          { action: 'api::music.music.find' },
          { action: 'api::music.music.findOne' },
          { action: 'api::music.music.addComment' },
          // MrKeyp Storage Files
          { action: 'api::storage-file.storage-file.find' },
          { action: 'api::storage-file.storage-file.findOne' },
          { action: 'api::storage-file.storage-file.create' },
          { action: 'api::storage-file.storage-file.update' },
          { action: 'api::storage-file.storage-file.delete' },
          { action: 'api::storage-file.storage-file.bulkDelete' },
          { action: 'api::storage-file.storage-file.trash' },
          { action: 'api::storage-file.storage-file.restore' },
          { action: 'api::storage-file.storage-file.emptyTrash' },
          { action: 'api::storage-file.storage-file.storageUsage' },
          { action: 'api::storage-file.storage-file.getUploadUrl' },
          { action: 'api::storage-file.storage-file.initiateUpload' },
          { action: 'api::storage-file.storage-file.getPartUrl' },
          { action: 'api::storage-file.storage-file.completeUpload' },
          // MrKeyp Storage Folders
          { action: 'api::storage-folder.storage-folder.find' },
          { action: 'api::storage-folder.storage-folder.findOne' },
          { action: 'api::storage-folder.storage-folder.create' },
          { action: 'api::storage-folder.storage-folder.update' },
          { action: 'api::storage-folder.storage-folder.delete' },
          // MrKeyp Shared Links
          { action: 'api::shared-link.shared-link.find' },
          { action: 'api::shared-link.shared-link.create' },
          { action: 'api::shared-link.shared-link.delete' },
          { action: 'api::shared-link.shared-link.access' },
          // MrKeyp Shared Accounts
          { action: 'api::account-invitation.account-invitation.create' },
          { action: 'api::account-invitation.account-invitation.mine' },
          { action: 'api::account-invitation.account-invitation.accept' },
          { action: 'api::account-invitation.account-invitation.delete' },
          { action: 'api::account-invitation.account-invitation.preview' },
          // MrKeyp Storage Subscriptions
          { action: 'api::storage-subscription.storage-subscription.me' },
          { action: 'api::storage-subscription.storage-subscription.find' },
          { action: 'api::storage-subscription.storage-subscription.create' },
          { action: 'api::storage-subscription.storage-subscription.checkStatus' },
          { action: 'api::storage-subscription.storage-subscription.pricing' },
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
      }

      // Create Admin role for frontend admins (users-permissions)
      let adminRole = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { type: 'admin' },
      });

      if (!adminRole) {
        adminRole = await strapi.db.query('plugin::users-permissions.role').create({
          data: {
            name: 'Keyp Admin',
            description: 'Admin users who can manage the Keyp platform and storage operations',
            type: 'admin',
          },
        });
      } else if (adminRole.name !== 'Keyp Admin' || adminRole.description !== 'Admin users who can manage the Keyp platform and storage operations') {
        adminRole = await strapi.db.query('plugin::users-permissions.role').update({
          where: { id: adminRole.id },
          data: {
            name: 'Keyp Admin',
            description: 'Admin users who can manage the Keyp platform and storage operations',
          },
        });
      }

      if (adminRole) {
        const adminPermissions = [
          // Full movie CRUD
          { action: 'api::movie.movie.find' },
          { action: 'api::movie.movie.findOne' },
          { action: 'api::movie.movie.create' },
          { action: 'api::movie.movie.update' },
          { action: 'api::movie.movie.delete' },
          { action: 'api::movie.movie.bulkDrafts' },
          { action: 'api::movie.movie.bunnyCreateUpload' },
          { action: 'api::movie.movie.bunnyEncodeStatus' },
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
          { action: 'api::free-trial-watch.free-trial-watch.adminList' },
          { action: 'api::free-trial-watch.free-trial-watch.find' },
          { action: 'api::free-trial-watch.free-trial-watch.delete' },
          // Active Streaming
          { action: 'api::active-stream.active-stream.heartbeat' },
          { action: 'api::active-stream.active-stream.stop' },
          { action: 'api::active-stream.active-stream.adminList' },
          { action: 'api::active-stream.active-stream.adminHistory' },
          { action: 'api::active-stream.active-stream.parentHistory' },
          // Contact messages (admin)
          { action: 'api::contact-message.contact-message.find' },
          { action: 'api::contact-message.contact-message.findOne' },
          { action: 'api::contact-message.contact-message.create' },
          { action: 'api::contact-message.contact-message.update' },
          { action: 'api::contact-message.contact-message.delete' },
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
          // Email notifications (admin only)
          { action: 'api::email-notification.email-notification.sendContentUpdate' },
          { action: 'api::email-notification.email-notification.testExpiry' },
          // MrKeyp Storage Admin
          { action: 'api::storage-file.storage-file.find' },
          { action: 'api::storage-file.storage-file.findOne' },
          { action: 'api::storage-file.storage-file.create' },
          { action: 'api::storage-file.storage-file.update' },
          { action: 'api::storage-file.storage-file.delete' },
          { action: 'api::storage-file.storage-file.bulkDelete' },
          { action: 'api::storage-file.storage-file.trash' },
          { action: 'api::storage-file.storage-file.restore' },
          { action: 'api::storage-file.storage-file.emptyTrash' },
          { action: 'api::storage-file.storage-file.storageUsage' },
          { action: 'api::storage-file.storage-file.getUploadUrl' },
          { action: 'api::storage-file.storage-file.initiateUpload' },
          { action: 'api::storage-file.storage-file.getPartUrl' },
          { action: 'api::storage-file.storage-file.completeUpload' },
          { action: 'api::storage-folder.storage-folder.find' },
          { action: 'api::storage-folder.storage-folder.findOne' },
          { action: 'api::storage-folder.storage-folder.create' },
          { action: 'api::storage-folder.storage-folder.update' },
          { action: 'api::storage-folder.storage-folder.delete' },
          { action: 'api::shared-link.shared-link.find' },
          { action: 'api::shared-link.shared-link.create' },
          { action: 'api::shared-link.shared-link.delete' },
          { action: 'api::shared-link.shared-link.access' },
          { action: 'api::account-invitation.account-invitation.create' },
          { action: 'api::account-invitation.account-invitation.mine' },
          { action: 'api::account-invitation.account-invitation.accept' },
          { action: 'api::account-invitation.account-invitation.delete' },
          { action: 'api::account-invitation.account-invitation.preview' },
          { action: 'api::storage-subscription.storage-subscription.me' },
          { action: 'api::storage-subscription.storage-subscription.find' },
          { action: 'api::storage-subscription.storage-subscription.create' },
          { action: 'api::storage-subscription.storage-subscription.checkStatus' },
          { action: 'api::storage-subscription.storage-subscription.grant' },
          { action: 'api::storage-subscription.storage-subscription.revoke' },
          { action: 'api::storage-subscription.storage-subscription.adminStats' },
          { action: 'api::storage-subscription.storage-subscription.adminUsers' },
          { action: 'api::storage-subscription.storage-subscription.pricing' },
          // Music management
          { action: 'api::music.music.find' },
          { action: 'api::music.music.findOne' },
          { action: 'api::music.music.addComment' },
          { action: 'api::music.music.create' },
          { action: 'api::music.music.update' },
          { action: 'api::music.music.delete' },
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
      }

      const [storageFiles, storageFolders, storageSubscriptions, accountInvitations] = await Promise.all([
        strapi.entityService.findMany('api::storage-file.storage-file', {
          limit: -1,
          populate: { owner: { fields: ['id'] } },
        }),
        strapi.entityService.findMany('api::storage-folder.storage-folder', {
          limit: -1,
          populate: { owner: { fields: ['id'] } },
        }),
        strapi.entityService.findMany('api::storage-subscription.storage-subscription', {
          limit: -1,
          populate: { subscriber: { fields: ['id'] } },
        }),
        strapi.entityService.findMany('api::account-invitation.account-invitation', {
          limit: -1,
          populate: {
            inviter: { fields: ['id'] },
            invitee: { fields: ['id'] },
          },
        }),
      ]);

      const keypUserIds = new Set();
      for (const file of storageFiles || []) {
        if (file.owner?.id) keypUserIds.add(file.owner.id);
      }
      for (const folder of storageFolders || []) {
        if (folder.owner?.id) keypUserIds.add(folder.owner.id);
      }
      for (const subscription of storageSubscriptions || []) {
        if (subscription.subscriber?.id) keypUserIds.add(subscription.subscriber.id);
      }
      for (const invitation of accountInvitations || []) {
        if (invitation.inviter?.id) keypUserIds.add(invitation.inviter.id);
        if (invitation.invitee?.id) keypUserIds.add(invitation.invitee.id);
      }

      if (keypUserIds.size > 0) {
        const knownKeypUsers = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { id: { $in: [...keypUserIds] } },
          select: ['id', 'isKeypUser', 'keypActivatedAt'],
        });

        for (const keypUser of knownKeypUsers) {
          if (keypUser.isKeypUser) continue;
          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: keypUser.id },
            data: {
              isKeypUser: true,
              keypActivatedAt: keypUser.keypActivatedAt || new Date().toISOString(),
            },
          });
        }
      }
    } catch (err) {
      // Failed to set permissions
    }

    // ── Bunny Stream encode poller ──
    // When admins upload via Bunny, the video isn't playable until Bunny
    // finishes transcoding into the HLS ABR ladder. We start movies as
    // isAvailable: false on upload, then poll Bunny here every minute and
    // flip them to isAvailable: true once encoding is finished.
    // Note: we deliberately use `isAvailable` (not a "status" field) because
    // `status` is a reserved Strapi keyword that has caused issues here.
    try {
      const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
      const apiKey = process.env.BUNNY_STREAM_API_KEY;
      if (libraryId && apiKey) {
        const BUNNY_FINISHED = 4; // 0=Created 1=Uploaded 2=Processing 3=Transcoding 4=Finished 5=Error 6=UploadFailed
        const fetchBunnyEncode = async (videoId) => {
          try {
            const res = await fetch(
              `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`,
              { headers: { AccessKey: apiKey, accept: 'application/json' } }
            );
            if (!res.ok) return null;
            return await res.json();
          } catch {
            return null;
          }
        };

        // Re-entrancy guard — if a pass is still in flight (slow Bunny API,
        // many pending videos), skip the next tick rather than stacking up
        // queries and exhausting the DB connection pool.
        let pollInFlight = false;

        const pollBunnyEncoding = async () => {
          if (pollInFlight) return;
          pollInFlight = true;
          try {
            // Find pending movies with at least one Bunny video that isn't
            // yet marked available. Limit per pass so we don't hammer Bunny
            // or hold DB connections for long.
            let pending = [];
            try {
              pending = await strapi.db.query('api::movie.movie').findMany({
                where: {
                  isAvailable: false,
                  $or: [
                    { bunnyVideoId: { $notNull: true } },
                    { lugandaBunnyVideoId: { $notNull: true } },
                  ],
                },
                select: ['id', 'documentId', 'title', 'bunnyVideoId', 'lugandaBunnyVideoId'],
                limit: 20,
              });
            } catch (qErr) {
              // DB unavailable / pool exhausted — just skip this pass.
              strapi.log.warn(`[bunny-poll] Skipping pass (DB unavailable): ${qErr.message || qErr}`);
              return;
            }

            if (!pending.length) return;

            for (const m of pending) {
              const ids = [m.bunnyVideoId, m.lugandaBunnyVideoId].filter(Boolean);
              if (!ids.length) continue;

              let allFinished = true;
              let anyError = false;
              for (const vid of ids) {
                const info = await fetchBunnyEncode(vid);
                if (!info) { allFinished = false; continue; }
                const encState = Number(info.status); // Bunny's field, used locally only
                if (encState === BUNNY_FINISHED) continue;
                if (encState === 5 || encState === 6) {
                  anyError = true;
                  allFinished = false;
                  strapi.log.warn(
                    `[bunny-poll] Encoding error for movie "${m.title}" (videoId=${vid}, encState=${encState})`
                  );
                  break;
                }
                allFinished = false;
              }

              if (allFinished && !anyError) {
                try {
                  await strapi.documents('api::movie.movie').update({
                    documentId: m.documentId,
                    data: { isAvailable: true },
                    status: 'published',
                  });
                  strapi.log.info(
                    `[bunny-poll] Movie "${m.title}" finished encoding — set isAvailable=true`
                  );
                } catch (err) {
                  strapi.log.error('[bunny-poll] Failed to update movie', err?.message || err);
                }
              }
            }
          } catch (err) {
            strapi.log.error('[bunny-poll] Pass failed', err?.message || err);
          } finally {
            pollInFlight = false;
          }
        };

        // First pass after a longer delay (let Strapi finish booting and DB
        // pool settle), then repeat every 2 minutes — long enough that a slow
        // pass won't overlap, short enough to keep new uploads timely.
        setTimeout(pollBunnyEncoding, 30 * 1000);
        setInterval(pollBunnyEncoding, 2 * 60 * 1000);
        strapi.log.info('[bunny-poll] Bunny Stream encode poller started');
      }
    } catch (err) {
      strapi.log.error('[bunny-poll] Failed to start poller', err);
    }
  },
};
