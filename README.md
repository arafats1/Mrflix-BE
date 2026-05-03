# 🚀 Getting started with Strapi

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/dev-docs/cli) (CLI) which lets you scaffold and manage your project in seconds.

### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-develop)

```
npm run develop
# or
yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# or
yarn build
```

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project including [Strapi Cloud](https://cloud.strapi.io). Browse the [deployment section of the documentation](https://docs.strapi.io/dev-docs/deployment) to find the best solution for your use case.

```
yarn strapi deploy
```

## Movie Export API

Expose the catalog to another platform with a single endpoint:

```bash
curl "https://your-backend.example.com/api/movies/export?page=1&pageSize=100" \
	-H "Authorization: Bearer $MOVIE_EXPORT_API_KEY"
```

Set `MOVIE_EXPORT_API_KEY` in the backend environment before using it. Send it as `Authorization: Bearer ...` or `?apiKey=...`.
The key is effectively read-only because it only unlocks the `GET /api/movies/export` endpoint.

Response shape:

- `data[]`: normalized movie objects with metadata, poster/backdrop/video asset URLs, trailer URL, direct video URLs, Bunny HLS/iframe playback links, and episode payloads.
- `meta`: pagination and filter metadata.

Query params:

- `page`, `pageSize`: paginate results, default `1` and `100`.
- `includeUnavailable=true`: include titles hidden from the public catalog.
- `includeDrafts=true`: include unpublished entries.
- `includeAdult=true`: include `isAdult` and `isXXX` titles.
- `updatedSince=ISO_DATE`: return only titles updated at or after the provided timestamp.

See [docs/movie-export-api.md](docs/movie-export-api.md) for Postman setup, sample responses, and integration examples.

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>
