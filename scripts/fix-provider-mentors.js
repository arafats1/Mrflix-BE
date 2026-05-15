'use strict';

/**
 * Script to update existing entrep-profiles with 'provider' role to have isMentor: true.
 * Run this using: node scripts/update-mentors.js
 */

const axios = require('axios'); // Note: Strapi logic is better run via a boostrapped script, but since we are in terminal, we can use a small script if we have access to strapi.
// Alternatively, since I can't easily run a "strapi console" command here and pipe input, 
// I will provide the code that the user can run in their Strapi environment or I'll try to run it via `run_in_terminal` if I can bootstrap Strapi.

// Given I am an agent, I'll suggest a simpler way: a temporary route or just the command.
// But I can also try to write a script that uses the Strapi instance if I run it with `strapi scripts/custom.js` style if supported, 
// or just standard node if I bootstrap it.

async function updateExistingProviders(app) {
  console.log('Starting update for existing providers...');
  // This script assumes it's being run in a context where 'strapi' is global (like strapi console)
  // or it bootstraps strapi.
  
  try {
    const profiles = await app.entityService.findMany('api::entrep-profile.entrep-profile', {
      filters: {
        role: 'provider',
        isMentor: false,
      },
    });

    console.log(`Found ${profiles.length} profiles to update.`);

    for (const profile of profiles) {
      await app.entityService.update('api::entrep-profile.entrep-profile', profile.id, {
        data: { isMentor: true },
      });
      console.log(`Updated profile ID: ${profile.id}`);
    }

    console.log('Update complete.');
  } catch (err) {
    console.error('Error updating profiles:', err);
  }
}

// In Strapi 4, we can bootstrap it:
const strapi = require('@strapi/strapi');

async function main() {
  const app = await strapi.createStrapi().load();
  await updateExistingProviders(app);
  await app.destroy();
  process.exit(0);
}

main();
