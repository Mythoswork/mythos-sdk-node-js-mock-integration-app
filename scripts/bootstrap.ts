import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { getConfig } from '../lib/config';
import { login, createWebAppListing } from '../lib/mythos-api-client';

process.loadEnvFile(join(__dirname, '..', '.env.local'));

async function main() {
  const config = getConfig();

  console.log(`Logging in as ${config.testUserEmail} against ${config.mythosApiUrl}...`);
  const { token } = await login(config.mythosApiUrl, config.testUserEmail, config.testUserPassword);

  console.log('Creating web-app listing (status: published)...');
  const listing = await createWebAppListing(config.mythosApiUrl, token, {
    title: 'Mythos Calculator Mockup',
    description: 'Calculator app exercising launch, handshake, consume, and metering.',
    category: 'Web Development',
    launch_url: `${config.calculatorBaseUrl}/calculator`,
    status: 'published',
    cover_image: 'https://example.com/calculator-cover.png',
    price_credits: 1,
    producer_margin_pct: 100,
  });

  console.log(`Listing created: ${listing.listing_id}`);

  const envPath = join(__dirname, '..', '.env.local');
  const envContent = readFileSync(envPath, 'utf8');
  const updated = envContent.includes('MYTHOS_LISTING_ID=')
    ? envContent.replace(/MYTHOS_LISTING_ID=.*/, `MYTHOS_LISTING_ID=${listing.listing_id}`)
    : `${envContent}\nMYTHOS_LISTING_ID=${listing.listing_id}\n`;
  writeFileSync(envPath, updated);

  console.log('.env.local updated with MYTHOS_LISTING_ID.');
  console.log('Restart the dev server (npm run dev -- -p 3001) to pick up the new listing ID.');
}

main().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
