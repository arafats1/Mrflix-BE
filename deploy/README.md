# Deploying Mrflix-BE to the Contabo VPS

This uses the same setup as Bear-BE, al-sonya-BE, TUOGERE-BE, Lensh-BE and SALI-BE, on the same server (`45.13.235.212`):

- **Code:** `/opt/mrflix/src`, synced by GitHub Actions on every push to `main`
- **App secrets:** `/opt/mrflix/.env`, copied from Railway, with `PUBLIC_URL=https://movo.ara44.com`
- **MySQL passwords:** `/opt/mrflix/db.env`, generated on the server
- **Backups:** `/opt/mrflix/backups`, nightly at 03:00, kept for 14 days
- **Uploads:** stored in the Docker volume `mrflix_uploads`, so they survive deploys
- **HTTPS:** handled by the shared Caddy in `/opt/edge`; the site file is `/opt/edge/sites/mrflix.caddy`

## Everyday commands (on the server, as `deploy`)

```bash
bash /opt/mrflix/src/deploy/logs.sh            # app logs
bash /opt/mrflix/src/deploy/remote-deploy.sh   # redeploy by hand
bash /opt/mrflix/src/deploy/backup-db.sh       # backup now
```

To open the database in a GUI, use an SSH tunnel to `127.0.0.1:3312`. The credentials are in `/opt/mrflix/db.env`.

## Payment callbacks

Pesapal and Airtel callbacks are built from `PUBLIC_URL`. On the VPS it is
`https://movo.ara44.com`, and the Pesapal IPN ID in Site settings was re-registered
for that URL after the move from Railway.

## Bunny CDN

The website (Movies-App) calls the API through the Bunny pull zone
`movobrands.b-cdn.net`. Its origin must be `https://movo.ara44.com`, not the old
`*.up.railway.app` address.
