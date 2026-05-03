# Movie Export API Integration Guide

## Purpose

This API exposes the full movie catalog in a format another platform can consume directly.

Endpoint:

```text
GET /api/movies/export
```

Base example:

```text
https://your-backend.example.com/api/movies/export
```

## Authentication

Use the backend environment variable `MOVIE_EXPORT_API_KEY` as a Bearer token.

Example:

```http
Authorization: Bearer your_export_api_key
```

Important:

- This is not a Strapi admin token or a Strapi API token with role scopes.
- In the current implementation, it is a custom secret checked only by `GET /api/movies/export`.
- So yes, it is effectively read-only because it only grants access to this read-only export endpoint.
- Use a long random value, for example 32 to 64+ characters.

Example key generation:

```bash
openssl rand -hex 32
```

## Query Parameters

All query params are optional.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `page` | number | `1` | Page number |
| `pageSize` | number | `100` | Records per page, max `500` |
| `includeUnavailable` | boolean | `false` | Include titles hidden from public catalog |
| `includeDrafts` | boolean | `false` | Include unpublished entries |
| `includeAdult` | boolean | `false` | Include titles normally excluded by adult-content filters |
| `updatedSince` | ISO date string | none | Return only titles updated on or after this timestamp |
| `apiKey` | string | none | Alternative to Bearer auth if needed |

Example:

```text
/api/movies/export?page=1&pageSize=50&updatedSince=2026-05-01T00:00:00.000Z
```

## Postman Test Steps

### Option 1: Recommended, use Bearer token

1. Open Postman and create a new `GET` request.
2. Set the request URL to:

```text
http://localhost:1337/api/movies/export?page=1&pageSize=10
```

3. Open the `Authorization` tab.
4. Set `Type` to `Bearer Token`.
5. Paste your `MOVIE_EXPORT_API_KEY` value into the token field.
6. Click `Send`.

If everything is correct, you should get:

- HTTP `200 OK`
- A JSON response with `data` and `meta`

### Option 2: Use query string

Set the URL to:

```text
http://localhost:1337/api/movies/export?page=1&pageSize=10&apiKey=your_export_api_key
```

Then click `Send`.

### Common Postman checks

- `403 Forbidden`: wrong or missing key.
- `400 Bad Request`: usually an invalid `updatedSince` format.
- Empty `data`: the filter excluded everything, or there are no published/available movies matching the filters.

## Example Requests

### Local development

```bash
curl "http://localhost:1337/api/movies/export?page=1&pageSize=10" \
  -H "Authorization: Bearer your_export_api_key"
```

### Production

```bash
curl "https://api.example.com/api/movies/export?page=1&pageSize=100&includeUnavailable=true" \
  -H "Authorization: Bearer your_export_api_key"
```

### Incremental sync

```bash
curl "https://api.example.com/api/movies/export?updatedSince=2026-05-01T00:00:00.000Z" \
  -H "Authorization: Bearer your_export_api_key"
```

## Response Structure

Top-level response:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 100,
    "total": 0,
    "pageCount": 0,
    "hasNextPage": false,
    "filters": {
      "includeUnavailable": false,
      "includeDrafts": false,
      "includeAdult": false,
      "updatedSince": null
    },
    "generatedAt": "2026-05-03T12:00:00.000Z"
  }
}
```

Movie item example:

```json
{
  "id": "abc123documentid",
  "strapiId": 17,
  "documentId": "abc123documentid",
  "slug": null,
  "title": "The Karate Kid",
  "overview": "A young fighter learns discipline and courage.",
  "type": "movie",
  "tmdbId": 1885,
  "releaseDate": "2010-06-10",
  "rating": 6.2,
  "genres": ["Action", "Drama", "Family"],
  "seasons": null,
  "countryOfOrigin": "USA",
  "isLuganda": false,
  "translatedLanguage": null,
  "vjName": null,
  "religiousCategory": null,
  "posterUrl": "https://cdn.example.com/posters/karate-kid.jpg",
  "backdropUrl": "https://cdn.example.com/backdrops/karate-kid.jpg",
  "trailerUrl": "https://www.youtube.com/watch?v=example",
  "subtitleUrl": null,
  "videoUrl": "https://cdn.example.com/videos/karate-kid.mp4",
  "videoUrl720": null,
  "videoUrl480": null,
  "bunnyVideoId": "7b7f2dca-xxxx-xxxx-xxxx-xxxxxxxx",
  "playback": {
    "videoId": "7b7f2dca-xxxx-xxxx-xxxx-xxxxxxxx",
    "hlsUrl": "https://vz-example.b-cdn.net/7b7f2dca-xxxx-xxxx-xxxx-xxxxxxxx/playlist.m3u8",
    "iframeUrl": "https://iframe.mediadelivery.net/embed/651813/7b7f2dca-xxxx-xxxx-xxxx-xxxxxxxx?autoplay=false&preload=true&responsive=true"
  },
  "translatedAudio": {
    "language": null,
    "videoUrl": null,
    "videoUrl720": null,
    "videoUrl480": null,
    "bunnyVideoId": null,
    "playback": null
  },
  "assets": {
    "poster": {
      "id": 11,
      "documentId": "poster-doc-id",
      "name": "karate-kid-poster.jpg",
      "alternativeText": null,
      "caption": null,
      "width": 1200,
      "height": 1800,
      "mime": "image/jpeg",
      "ext": ".jpg",
      "sizeKB": 182.4,
      "url": "https://cdn.example.com/posters/karate-kid.jpg"
    },
    "backdrop": null,
    "video": null
  },
  "episodes": [],
  "translatedEpisodes": [],
  "createdAt": "2026-04-20T10:00:00.000Z",
  "updatedAt": "2026-05-03T08:30:00.000Z",
  "publishedAt": "2026-04-20T10:05:00.000Z"
}
```

## What Another Platform Should Use

Recommended field usage:

- Use `id` as the external content identifier.
- Use `posterUrl` and `backdropUrl` for images.
- Use `trailerUrl` for the trailer.
- Use `playback.hlsUrl` when `bunnyVideoId` exists and the partner supports HLS.
- Fall back to `videoUrl`, `videoUrl720`, or `videoUrl480` when direct file playback is needed.
- For translated content, check `translatedAudio` and `translatedEpisodes`.
- For series, use `episodes` as the canonical episode list.

## Sample Integration

### JavaScript / Node.js

```js
const res = await fetch('https://api.example.com/api/movies/export?page=1&pageSize=100', {
  headers: {
    Authorization: 'Bearer your_export_api_key',
  },
});

if (!res.ok) {
  throw new Error(`Export failed: ${res.status}`);
}

const payload = await res.json();

for (const movie of payload.data) {
  const playbackUrl = movie.playback?.hlsUrl || movie.videoUrl || movie.videoUrl720 || movie.videoUrl480;
  console.log(movie.title, playbackUrl);
}
```

### PHP

```php
<?php
$ch = curl_init('https://api.example.com/api/movies/export?page=1&pageSize=100');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  'Authorization: Bearer your_export_api_key',
  'Accept: application/json',
]);

$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($status !== 200) {
  throw new Exception('Export failed with status ' . $status);
}

$payload = json_decode($response, true);
foreach ($payload['data'] as $movie) {
  $playbackUrl = $movie['playback']['hlsUrl'] ?? $movie['videoUrl'] ?? null;
  echo $movie['title'] . ' => ' . $playbackUrl . PHP_EOL;
}
```

## Recommended Sync Strategy

- Run a full sync first with `page` and `pageSize`.
- Store `id` and `updatedAt` on the partner platform.
- Then run incremental syncs with `updatedSince`.
- If the partner caches media aggressively, re-check `updatedAt` before overwriting.

## Security Notes

- Keep `MOVIE_EXPORT_API_KEY` private.
- Do not embed it in public browser apps.
- Prefer server-to-server usage.
- Rotate the key if it is shared with a partner and later needs to be revoked.

## Current Limitations

- The current export key is one shared secret, not a multi-partner token system.
- There is no per-partner rate limiting yet.
- There is no built-in token expiry yet.

If you need that next, add partner records with hashed keys, revocation, expiry, and request logging.