export interface LoginResult {
  token: string;
  refreshToken: string;
  user: { id: string; email: string; name: string; rolePreference: string; accountVerified: boolean };
}

export interface WalletSummary {
  success: boolean;
  subscription: number;
  topup: number;
  total: number;
  resetsAt: string | null;
  currentPlan: { planId: string; name: string; monthlyPriceCents: number; grantCredits: number; billingCycleDays: number } | null;
}

export interface CreateWebAppListingInput {
  title: string;
  description: string;
  category: string;
  launch_url: string;
  status: 'draft' | 'published';
  cover_image: string;
  thumbnail_image?: string;
  price_credits?: number;
  producer_margin_pct?: number;
}

export interface LaunchResult {
  launch_url: string;
  launch_token: string;
  expires_at: string;
  frame_sandbox: string[];
}

export interface LaunchHistoryItem {
  listing_id: string;
  title: string;
  thumbnail_url: string | null;
  launch_count: number;
  last_launched_at: string;
  total_metered_credits_charged: number;
}

async function parseJsonOrThrow<T>(res: Response, label: string): Promise<T> {
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${label} failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  return body as T;
}

export async function login(apiUrl: string, email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await parseJsonOrThrow<{
    token: string;
    refreshToken: string;
    user: LoginResult['user'];
  }>(res, 'login');
  return { token: body.token, refreshToken: body.refreshToken, user: body.user };
}

export async function getWallet(apiUrl: string, bearerToken: string): Promise<WalletSummary> {
  const res = await fetch(`${apiUrl}/api/wallet`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  return parseJsonOrThrow<WalletSummary>(res, 'getWallet');
}

export async function createWebAppListing(
  apiUrl: string,
  bearerToken: string,
  input: CreateWebAppListingInput
): Promise<{ listing_id: string; launch_url: string; frame_sandbox: string[] }> {
  const res = await fetch(`${apiUrl}/api/listings/web-app`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify(input),
  });
  const body = await parseJsonOrThrow<{ data: { listing_id: string; launch_url: string; frame_sandbox: string[] } }>(
    res,
    'createWebAppListing',
  );
  return body.data;
}

export async function launchApp(apiUrl: string, bearerToken: string, listingId: string): Promise<LaunchResult> {
  const res = await fetch(`${apiUrl}/api/apps/${listingId}/launch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  const body = await parseJsonOrThrow<{ data: LaunchResult }>(res, 'launchApp');
  return body.data;
}

export async function getLaunchHistory(
  apiUrl: string,
  bearerToken: string,
  limit = 20,
  offset = 0
): Promise<{ data: LaunchHistoryItem[]; total: number; limit: number; offset: number }> {
  const res = await fetch(`${apiUrl}/api/launch-history?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  return parseJsonOrThrow<{ data: LaunchHistoryItem[]; total: number; limit: number; offset: number }>(res, 'getLaunchHistory');
}

export function decodeLaunchTokenJti(launchToken: string): string {
  const parts = launchToken.split('.');
  if (parts.length !== 3) {
    throw new Error('launch_token is not a valid JWT (expected 3 dot-separated segments)');
  }
  const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
  const payload = JSON.parse(payloadJson);
  if (!payload.jti) {
    throw new Error('launch_token payload has no jti claim');
  }
  return payload.jti as string;
}
