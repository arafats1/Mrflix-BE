'use strict';

const crypto = require('crypto');

function getAllowedOrigins() {
  return [
    process.env.MRKEYP_URL,
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://localhost:3000',
    'https://www.mymovokids.com',
    'https://mymovokids.com',
    'https://movo-kids.vercel.app',
  ]
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  async connect(ctx) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return ctx.badRequest('Google OAuth is not configured');
    }

    const redirectUriToFrontend = ctx.query.redirect_uri;
    if (!redirectUriToFrontend) {
      return ctx.badRequest('redirect_uri is required');
    }

    let parsedRedirect;
    try {
      parsedRedirect = new URL(redirectUriToFrontend);
    } catch {
      return ctx.badRequest('Invalid redirect_uri');
    }

    const allowedOrigins = getAllowedOrigins();
    if (!allowedOrigins.includes(parsedRedirect.origin)) {
      return ctx.badRequest('redirect_uri origin is not allowed');
    }

    const state = crypto.randomBytes(20).toString('hex');
    ctx.cookies.set('gw_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
    });
    ctx.cookies.set('gw_redirect_uri', redirectUriToFrontend, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
    });

    const backendUrl = strapi.config.get('server.url') || `${ctx.protocol}://${ctx.host}`;
    const redirectUri = `${backendUrl}/api/google-web-auth/callback`;

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

  async callback(ctx) {
    const { code, state, error: oauthError } = ctx.query;
    const frontendRedirect = ctx.cookies.get('gw_redirect_uri') || process.env.MRKEYP_URL || process.env.FRONTEND_URL;

    ctx.cookies.set('gw_redirect_uri', '', { maxAge: 0 });

    if (!frontendRedirect) {
      return ctx.badRequest('No frontend redirect configured');
    }

    const redirectUrl = new URL(frontendRedirect);

    if (oauthError) {
      redirectUrl.searchParams.set('error', oauthError);
      return ctx.redirect(redirectUrl.toString());
    }

    const storedState = ctx.cookies.get('gw_oauth_state');
    ctx.cookies.set('gw_oauth_state', '', { maxAge: 0 });
    if (!state || state !== storedState) {
      redirectUrl.searchParams.set('error', 'Invalid state');
      return ctx.redirect(redirectUrl.toString());
    }

    if (!code) {
      redirectUrl.searchParams.set('error', 'No authorization code received');
      return ctx.redirect(redirectUrl.toString());
    }

    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const backendUrl = strapi.config.get('server.url') || `${ctx.protocol}://${ctx.host}`;
      const redirectUri = `${backendUrl}/api/google-web-auth/callback`;

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

      redirectUrl.searchParams.set('access_token', tokenData.access_token);
      if (tokenData.id_token) {
        redirectUrl.searchParams.set('id_token', tokenData.id_token);
      }
      return ctx.redirect(redirectUrl.toString());
    } catch (err) {
      strapi.log.error('Google web auth error:', err.message);
      redirectUrl.searchParams.set('error', err.message || 'Authentication failed');
      return ctx.redirect(redirectUrl.toString());
    }
  },
};