'use strict';

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'Movo Brands <support@movobrands.com>';

/**
 * Shared wrapper around the base layout so every email looks consistent.
 */
function baseLayout(bodyHtml) {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#000;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#141414;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a1a,#0a0a0a);padding:28px 32px;text-align:center;border-bottom:2px solid #eab308;">
            <h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:32px;font-weight:800;color:#eab308;letter-spacing:-0.5px;">Mr.Flix</h1>
            <p style="margin:6px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#666;letter-spacing:2px;text-transform:uppercase;">No Buffers · No Ads · Just Movies</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#0a0a0a;padding:20px 32px;border-top:1px solid #222;text-align:center;">
            <p style="margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#666;">
              © ${new Date().getFullYear()} Mr.Flix — Your Premier Movie Store!
            </p>
            <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#444;">
              <a href="https://mrflix.app" style="color:#eab308;text-decoration:none;">mrflix.app</a> &nbsp;·&nbsp;
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function safeText(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shortText(value = '', max = 120) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

/**
 * HTML for a movie card used in emails.
 */
function movieCard(movie) {
  const poster = movie.posterUrl || '';
  const title = movie.title || 'Untitled';
  const year = movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : '';
  const type = movie.type === 'series' ? 'SERIES' : 'MOVIE';
  const genres = Array.isArray(movie.genres) ? movie.genres.slice(0, 2).join(' · ') : '';
  const summary = shortText(movie.overview || movie.description || movie.summary, 110);

  return `
    <td width="50%" style="padding:6px;vertical-align:top;">
      <div style="background:#1a1a1a;border-radius:10px;overflow:hidden;border:1px solid #2a2a2a;">
        ${poster ? `<img src="${poster}" alt="${title}" width="100%" style="display:block;height:200px;object-fit:cover;" />` : `<div style="height:200px;background:#222;display:flex;align-items:center;justify-content:center;"><span style="color:#555;font-size:40px;">🎬</span></div>`}
        <div style="padding:12px;">
          <span style="display:inline-block;background:#eab308;color:#000;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;margin-bottom:6px;">${type}</span>
          <p style="margin:4px 0 0;color:#fff;font-size:14px;font-weight:600;line-height:1.3;">${title}</p>
          <p style="margin:4px 0 0;color:#888;font-size:11px;">${[year, genres].filter(Boolean).join(' · ')}</p>
          ${summary ? `<p style="margin:8px 0 0;color:#b8b8b8;font-size:12px;line-height:1.45;">${safeText(summary)}</p>` : ''}
        </div>
      </div>
    </td>`;
}

/**
 * Build the subscription expired email HTML.
 */
function subscriptionExpiredHtml(user) {
  const name = user.fullName || user.username || 'there';
  return baseLayout(`
    <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 16px;">
      Hi <strong style="color:#fff;">${name}</strong>,
    </p>
    <p style="color:#d1d5db;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Your <strong style="color:#eab308;">Mr.Flix Premium</strong> subscription has ended. We hope you enjoyed unlimited access to our movie library!
    </p>

    <div style="background:#1a1a1a;border-radius:12px;padding:20px 24px;border-left:4px solid #eab308;margin:0 0 24px;">
      <p style="color:#fff;font-size:15px;font-weight:600;margin:0 0 8px;">Here's what you're missing:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
        <tr><td style="padding:4px 0;color:#d1d5db;font-size:14px;">✅ Unlimited movie & series streaming</td></tr>
        <tr><td style="padding:4px 0;color:#d1d5db;font-size:14px;">✅ Download movies for offline viewing</td></tr>
        <tr><td style="padding:4px 0;color:#d1d5db;font-size:14px;">✅ Early access to new releases</td></tr>
        <tr><td style="padding:4px 0;color:#d1d5db;font-size:14px;">✅ No ads, no interruptions</td></tr>
      </table>
    </div>

    <div style="text-align:center;margin:28px 0;">
      <a href="https://mrflix.app/subscribe" style="display:inline-block;background:#eab308;color:#000;font-size:16px;font-weight:700;padding:14px 40px;border-radius:8px;text-decoration:none;">
        🔄 Renew Subscription
      </a>
    </div>

    <p style="color:#9ca3af;font-size:13px;text-align:center;margin:0;">
      Don't miss out — renew today and pick up right where you left off!
    </p>
  `);
}

/**
 * Build the content update / bulk email HTML.
 */
function contentUpdateHtml({ user, movies, series, message }) {
  const name = user.fullName || user.username || 'there';

  // Build movie cards grid (2 columns)
  let moviesSection = '';
  if (movies && movies.length > 0) {
    const rows = [];
    for (let i = 0; i < movies.length; i += 2) {
      const card1 = movieCard(movies[i]);
      const card2 = movies[i + 1] ? movieCard(movies[i + 1]) : '<td width="50%"></td>';
      rows.push(`<tr>${card1}${card2}</tr>`);
    }
    moviesSection = `
      <p style="color:#eab308;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:24px 0 10px;">🎬 New Movies</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>
    `;
  }

  let seriesSection = '';
  if (series && series.length > 0) {
    const rows = [];
    for (let i = 0; i < series.length; i += 2) {
      const card1 = movieCard(series[i]);
      const card2 = series[i + 1] ? movieCard(series[i + 1]) : '<td width="50%"></td>';
      rows.push(`<tr>${card1}${card2}</tr>`);
    }
    seriesSection = `
      <p style="color:#eab308;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:24px 0 10px;">📺 New Series</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>
    `;
  }

  // Admin custom message
  const customMsg = message
    ? `<div style="background:#1a1a1a;border-radius:12px;padding:20px 24px;border-left:4px solid #eab308;margin:20px 0;">
         <p style="color:#d1d5db;font-size:15px;line-height:1.7;margin:0;">${message.replace(/\n/g, '<br/>')}</p>
       </div>`
    : '';

  return baseLayout(`
    <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 16px;">
      Hi <strong style="color:#fff;">${name}</strong>,
    </p>
    <p style="color:#d1d5db;font-size:15px;line-height:1.7;margin:0 0 6px;">
      We've got fresh content waiting for you on <strong style="color:#eab308;">Mr.Flix</strong>! Check out what's new:
    </p>

    ${moviesSection}
    ${seriesSection}
    ${customMsg}

    <div style="text-align:center;margin:28px 0;">
      <a href="https://mrflix.app" style="display:inline-block;background:#eab308;color:#000;font-size:16px;font-weight:700;padding:14px 40px;border-radius:8px;text-decoration:none;">
        🎬 Watch Now
      </a>
    </div>

    <p style="color:#9ca3af;font-size:13px;text-align:center;margin:0;">
      Enjoy your movie night!
    </p>
  `);
}

/**
 * Send a single email via Resend.
 */
async function sendEmail({ to, subject, html }) {
  return resend.emails.send({ from: FROM, to, subject, html });
}

/**
 * Send subscription expired email to a single user.
 */
async function sendSubscriptionExpiredEmail(user) {
  if (!user.email) return;
  const html = subscriptionExpiredHtml(user);
  return sendEmail({
    to: user.email,
    subject: "Your Movo Brands subscription has ended — renew today! 🎬",
    html,
  });
}

/**
 * Send content update email to a single user.
 */
async function sendContentUpdateEmail({ user, movies, series, message }) {
  if (!user.email) return;
  const html = contentUpdateHtml({ user, movies, series, message });
  return sendEmail({
    to: user.email,
    subject: "🍿 New on Mr.Flix — Fresh Movies & Series just dropped!",
    html,
  });
}

module.exports = {
  sendEmail,
  sendSubscriptionExpiredEmail,
  sendContentUpdateEmail,
  subscriptionExpiredHtml,
  contentUpdateHtml,
};
