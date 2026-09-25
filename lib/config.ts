export interface AppConfig {
  mythosApiUrl: string;
  calculatorBaseUrl: string;
  mythosListingId: string | null;
  testUserEmail: string;
  testUserPassword: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

export function getConfig(): AppConfig {
  return {
    mythosApiUrl: requireEnv('MYTHOS_API_URL'),
    calculatorBaseUrl: requireEnv('CALCULATOR_BASE_URL'),
    mythosListingId: process.env['MYTHOS_LISTING_ID'] || null,
    testUserEmail: requireEnv('TEST_USER_EMAIL'),
    testUserPassword: requireEnv('TEST_USER_PASSWORD'),
  };
}

export function requireListingId(): string {
  const { mythosListingId } = getConfig();
  if (!mythosListingId) {
    throw new Error(
      'MYTHOS_LISTING_ID is not set. Run scripts/bootstrap.ts once, then restart the dev server.'
    );
  }
  return mythosListingId;
}
