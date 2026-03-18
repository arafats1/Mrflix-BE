'use strict';

const crypto = require('crypto');

/**
 * Google OAuth flow for mobile apps.
 *
 * Unlike the web flow (which uses Strapi's built-in Grant and redirects to the
 * web frontend), this controller manages the OAuth dance directly so it can
 * redirect back to the mobile app via deep link with a Strapi JWT.
 *
 * SETUP: Add the callback URL to your Google Cloud Console as an authorized
 * redirect URI:
 *   <PUBLIC_URL>/api/google-mobile-auth/callback
 *   e.g. https://mrflix-be-production.up.railway.app/api/google-mobile-auth/callback
 */
module.exports = {
  /**
   * GET /api/google-mobile-auth/connect
   * Generates the Google OAuth URL and redirects the user to Google's consent screen.
   */
  async connect(ctx) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return ctx.badRequest('Google OAuth is not configured');
    }

    // The mobile app sends its deep link URI (differs between Expo Go and standalone)
    const mobileRedirectUri = ctx.query.redirect_uri;
    if (!mobileRedirectUri) {
      return ctx.badRequest('redirect_uri is required');
    }

    // Validate that the redirect URI uses an allowed scheme
    const allowedPrefixes = ['mrflix://', 'exp://', 'exps://'];
    if (!allowedPrefixes.some((p) => mobileRedirectUri.startsWith(p))) {
      return ctx.badRequest('Invalid redirect_uri scheme');
    }

    // CSRF protection: generate a random state and store it in a cookie
    // Also store the mobile redirect URI so the callback can use it
    const state = crypto.randomBytes(20).toString('hex');
    ctx.cookies.set('gm_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000, // 5 minutes
    });
    ctx.cookies.set('gm_redirect_uri', mobileRedirectUri, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
    });

    const backendUrl = strapi.config.get('server.url') || `${ctx.protocol}://${ctx.host}`;
    const redirectUri = `${backendUrl}/api/google-mobile-auth/callback`;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    });

    ctx.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  },

  /**
   * GET /api/google-mobile-auth/callback
   * Google redirects here with an authorization code. We exchange it for tokens,
   * run the user through Strapi's provider flow, then redirect to the mobile
   * deep link with the Strapi JWT.
   */
  async callback(ctx) {
    const { code, state, error: oauthError } = ctx.query;
    const DEEP_LINK = ctx.cookies.get('gm_redirect_uri') || 'mrflix://auth/callback';

    // Clear the redirect URI cookie
    ctx.cookies.set('gm_redirect_uri', '', { maxAge: 0 });

    if (oauthError) {
      return ctx.redirect(`${DEEP_LINK}?error=${encodeURIComponent(oauthError)}`);
    }

    // Validate CSRF state
    const storedState = ctx.cookies.get('gm_oauth_state');
    ctx.cookies.set('gm_oauth_state', '', { maxAge: 0 }); // clear immediately
    if (!state || state !== storedState) {
      return ctx.redirect(`${DEEP_LINK}?error=${encodeURIComponent('Invalid state — please try again')}`);
    }

    if (!code) {
      return ctx.redirect(`${DEEP_LINK}?error=${encodeURIComponent('No authorization code received')}`);
    }

    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const backendUrl = strapi.config.get('server.url') || `${ctx.protocol}://${ctx.host}`;
      const redirectUri = `${backendUrl}/api/google-mobile-auth/callback`;

      // 1. Exchange the authorization code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        throw new Error(tokenData.error_description || 'Failed to obtain Google access token');
      }

      // 2. Use Strapi's users-permissions provider service to
      //    create / find the user (this also triggers the custom
      //    Google-name override in strapi-server.js).
      const providerService = strapi.plugin('users-permissions').service('providers');
      const result = await providerService.connect('google', {
        access_token: tokenData.access_token,
      });

      // Strapi returns [user, error] tuple
      const user = Array.isArray(result) ? result[0] : result;
      const providerError = Array.isArray(result) ? result[1] : null;

      if (providerError || !user) {
        throw new Error(
          typeof providerError === 'string'
            ? providerError
            : providerError?.message || 'Google authentication failed'
        );
      }

      if (user.blocked) {
        throw new Error('Your account has been blocked by an administrator');
      }

      // 3. Issue a Strapi JWT
      const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });

      // 4. Redirect to the mobile app deep link with the JWT
      ctx.redirect(`${DEEP_LINK}?jwt=${jwt}`);
    } catch (err) {
      strapi.log.error('Google mobile auth error:', err.message);
      ctx.redirect(
        `${DEEP_LINK}?error=${encodeURIComponent(err.message || 'Authentication failed')}`
      );
    }
  },
};
