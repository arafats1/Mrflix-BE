
const axios = require('axios');

// CONFIGURATION
const STRAPI_URL = 'https://mrflix-be-production.up.railway.app';
const API_TOKEN = '81a175ff9e9424143e77740a34a21fbcc7256f3a8779eb618cf88b7dc0e92678060f1b61cee57d2d50b6fc38950b80a0f8e3148186bb2cb2641f4f6e247e37e675b66cb3a0ce0a8a7eb1212ffb6dc305ed49a2e205290af46baea9d5c9d176cd29d308aa131af5923c4e50c1dd99e6ab225f7b409a7c4442251881231956a839'; // Get this from Strapi Settings > API Tokens (Full Access)

const OLD_HOST = 'f005.backblazeb2.com/file/Mrflix';
const NEW_HOST = 'mr-flix.b-cdn.net';

async function updateMovies() {
  try {
    // Fetch all movies (using pagination to get up to 100)
    const response = await axios.get(`${STRAPI_URL}/api/movies?pagination[pageSize]=100`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` }
    });

    const movies = response.data.data;

    for (const movie of movies) {
      const id = movie.documentId || movie.id;
      const attributes = movie;
      
      let updatedFields = {};
      let hasChanges = false;

      // Fields to check
      const fieldsToFix = ['embedUrl', 'videoUrl', 'videoUrl480', 'videoUrl720', 'videoUrlFull', 'subtitleUrl', 'lugandaVideoUrl', 'lugandaVideoUrl720', 'lugandaVideoUrl480'];

      // 1. Check top-level fields
      fieldsToFix.forEach(field => {
        const val = attributes[field];
        if (typeof val === 'string' && val.includes(OLD_HOST)) {
          updatedFields[field] = val.replace(OLD_HOST, NEW_HOST);
          hasChanges = true;
        }
      });

      // 2. Check nested episodes array (series)
      if (Array.isArray(attributes.episodes)) {
        let epChanged = false;
        const newEpisodes = attributes.episodes.map(ep => {
          let updatedEp = { ...ep };
          fieldsToFix.forEach(field => {
            if (typeof ep[field] === 'string' && ep[field].includes(OLD_HOST)) {
              updatedEp[field] = ep[field].replace(OLD_HOST, NEW_HOST);
              epChanged = true;
            }
          });
          return updatedEp;
        });

        if (epChanged) {
          updatedFields.episodes = newEpisodes;
          hasChanges = true;
        }
      }

      // 3. Check nested lugandaEpisodes array (Luganda series)
      if (Array.isArray(attributes.lugandaEpisodes)) {
        let lepChanged = false;
        const newLugandaEpisodes = attributes.lugandaEpisodes.map(ep => {
          let updatedEp = { ...ep };
          fieldsToFix.forEach(field => {
            if (typeof ep[field] === 'string' && ep[field].includes(OLD_HOST)) {
              updatedEp[field] = ep[field].replace(OLD_HOST, NEW_HOST);
              lepChanged = true;
            }
          });
          return updatedEp;
        });

        if (lepChanged) {
          updatedFields.lugandaEpisodes = newLugandaEpisodes;
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await axios.put(`${STRAPI_URL}/api/movies/${id}`, {
          data: updatedFields
        }, {
          headers: { Authorization: `Bearer ${API_TOKEN}` }
        });
      }
    }

    // For series, we need to check episodes too
    // In Strapi V5, episodes are usually a component or relation
    // We might need a separate loop if episodes are their own content type
    const epResponse = await axios.get(`${STRAPI_URL}/api/episodes?pagination[pageSize]=100`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` }
    }).catch(() => null);

    if (epResponse) {
        const episodes = epResponse.data.data;
        for (const ep of episodes) {
            const eid = ep.documentId || ep.id;
            let epUpdates = {};
            let epChanged = false;

            fieldsToFix.forEach(field => {
                const val = ep[field];
                if (val && val.includes(OLD_HOST)) {
                    epUpdates[field] = val.replace(OLD_HOST, NEW_HOST);
                    epChanged = true;
                }
            });

            if (epChanged) {
                await axios.put(`${STRAPI_URL}/api/episodes/${eid}`, { data: epUpdates }, {
                    headers: { Authorization: `Bearer ${API_TOKEN}` }
                });
            }
        }
    }
  } catch (error) {
    // Error occurred during update
  }
}

updateMovies();
