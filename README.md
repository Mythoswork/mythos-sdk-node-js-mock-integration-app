# Mythos Calculator Mockup

Reference/worked example of a **Producer** (third-party SaaS) integration with the Mythos marketplace. This is a disposable calculator app that exists only to prove the full `@mythos-work/sdk` contract end-to-end against a real running `mythos-backend`. Copy the pattern, not the calculator.

If you're integrating your own SaaS with Mythos, this doc is the part that matters — everything else in this repo is throwaway demo scaffolding (harness login page, fake standalone auth, etc).

---

## What "integrating with Mythos" actually means

Your app is a **Producer**. Mythos (the marketplace/FE) sends users to your app in an iframe with a signed `?lt=<token>` query param. Your job:

1. Create one SDK object at startup; it validates configuration and owns session handling.
2. Mount its catch-all handlers for launch, handshake and listing registration.
3. Initialize `useMythos()` in browser pages; it selects cookie/header transport and sends the handshake.
4. Charge calculator usage with `mythos.charge()` and route LLM inference through `mythos.llm()`.

None of this requires you to know anything about Mythos users, passwords, or sessions beyond what's in the signed token. You never see a Mythos password. You never call Mythos except through the SDK.

---

## 1. Install the SDK

```bash
npm install @mythos-work/sdk
```

This repo pins `@mythos-work/sdk@0.2.0`. Use the packed SDK tarball for local validation until 0.2.0 is published.

---

## 2. Mount the SDK handlers (required)

Mythos calls `POST /api/listings/web-app` (from your side, someone registers your app as a listing) → backend synchronously calls **your** `launch_url` + `/.well-known/mythos-handshake` with a short-lived signed check token, 5s timeout. If this fails, your listing registration fails outright.

```ts
// lib/mythos.ts
export const mythos = createMythos({ resolveListingIds: getListingIds, onListingRegistered: addListingId });

// pages/api/mythos/[...mythos].ts
export default pagesHandler(mythos);
```

Rewrite `/.well-known/mythos-handshake` to `/api/mythos/handshake` and `/.well-known/mythos-listing-registered` to `/api/mythos/listing-registered`. The SDK handles both well-known endpoints.

---

## 3. Establish the session (required)

The browser hook verifies the session, prefers the encrypted HttpOnly cookie, and falls back to the session header only when a one-time cookie probe fails. It returns `status: 'standalone'` for direct visits.

```tsx
import { useMythos } from '@mythos-work/sdk/react';

const { status, session, fetch: mythosFetch, confirmCharge, relaunch } = useMythos();
```

Use `mythosFetch` for app API calls. App code does not read tokens or construct session headers.

---

## 4. Tell the parent frame you're ready (required — easy to miss, breaks silently)

After step 3 succeeds, the Mythos FE waits for a handshake from your iframe. `useMythos()` sends it automatically when the session reaches `status: 'mythos'`.

```ts
const { status } = useMythos(); // handshake is automatic
```

---

## 5. Meter usage (required for any billable operation)

Call `mythos.charge()` with the server request. The SDK reads the cookie or `X-Mythos-Session` header and meters against the established session:

```ts
await mythos.charge(req, { credits: 1, reason: 'calculator:add' });
```

- `reportUsage` charges credits from the user's wallet immediately — real money-equivalent movement, not a log entry.
- Catch `InsufficientFundsError` → surface as HTTP 402 to your frontend, don't let it bubble as a generic 500.
- Catch `SessionNotFoundError` → the `lt` expired (5 min from mint) or was never valid.
- Charge whatever `credits` value makes sense per operation — the SDK doesn't enforce a fixed price, that's entirely up to you.

---

## 5a. Use SDK-owned LLM inference

LLM inference is different from calculator work: do not call `reportUsage` and do not send a
client-supplied credit amount. Create the official OpenAI client on your server with the request:

```ts
import { createMythos } from '@mythos-work/sdk';

const client = await mythos.llm(req, { apiKey: process.env.PRODUCER_OPENAI_API_KEY });
const completion = await client.chat.completions.create({
  model: 'openai/gpt-4o-mini',
  messages: [{ role: 'user', content: message }],
});
const billing = mythos.billing(completion);
```

The SDK sends the provider key and session identity to Mythos. The gateway observes provider
usage, settles the charge, and returns billing metadata. This mockup stores the identity-bearing
session in an encrypted HttpOnly cookie when cookies work. In header fallback mode, the opaque
session token is kept in tab-scoped `sessionStorage` and attached only to same-origin requests.

---

## 6. Bypass your own auth/paywall when a Mythos session is present

If your app also has its own independent login/subscription for direct (non-Mythos) traffic, branch on the SDK session:

```ts
if (!session) {
  // no Mythos session at all — this is direct traffic, run your own auth/paywall
  return <YourOwnLoginAndPaywallFlow />;
}
// Mythos session present — skip your own gate and use the SDK-backed charge/LLM APIs
```

These are two totally separate, non-linked identity systems. A user authenticated via Mythos gets access through Mythos credits, full stop — regardless of whether they also happen to have (or don't have) an account in your own system.

---

## 5b. Pre-charge confirmation (required)

Before firing any billable action, ask the shared browser client to confirm the charge with the Mythos dashboard. The Consumer must explicitly approve every charge:

```ts
const { approved } = await confirmCharge({ credits: 1, reason: `${operation}(${a}, ${b})` });
if (!approved) return; // charge skipped — your metering endpoint is never called
```

Protocol (identical to the reference client's contract):

```json
// producer iframe -> window.parent
{ "type": "mythos:confirm-charge", "requestId": "<uuid>", "credits": 1, "reason": "add(1, 2)" }
// window.parent -> producer iframe
{ "type": "mythos:confirm-charge-response", "requestId": "<uuid>", "approved": true }
// on timeout, producer iframe -> window.parent (so the dashboard can close a stale prompt)
{ "type": "mythos:confirm-charge-timeout", "requestId": "<uuid>" }
```

Fail-closed: the charge is skipped (your `/api/calculate`-equivalent is never called) if the
page isn't embedded, if no matching response arrives within the timeout (default `10000`ms),
or if the response is `approved: false`.

This depends entirely on the Mythos dashboard implementing the `mythos:confirm-charge`
listener and confirmation UI on its side. There is no opt-out — **any dashboard that hasn't
implemented the listener yet, or any non-embedded access to this page (including this repo's
own "Open Calculator" harness link on `/`, which opens in a new tab, not an iframe), will see
every charge silently declined.** Testing the full confirm → charge path locally requires
embedding `/calculator?lt=...` in a page that implements the `mythos:confirm-charge` listener
yourself.

---

## Registering your app as a listing

`POST /api/listings/web-app` (Mythos backend) with `{ title, description, category, launch_url, status, cover_image }`. `launch_url` must be `https://` with a real TLD in production (local dev backends may relax this — check with whoever runs your target `mythos-backend` instance).

This repo's `scripts/bootstrap.ts` (`npm run bootstrap`) does this once: logs in as a test user, creates the listing pointed at `CALCULATOR_BASE_URL`, and writes the returned `listing_id` into `.env.local` as `MYTHOS_LISTING_ID`. Restart your dev server after running it — env vars are read at process start, not per-request.

---

## Env vars your integration needs

```
MYTHOS_API_URL=<mythos-backend base URL, e.g. http://localhost:5001>
CALCULATOR_BASE_URL=<your app's own public base URL, e.g. http://localhost:3001>
MYTHOS_LISTING_ID=<written automatically by bootstrap.ts after registration>
MYTHOS_SESSION_SECRET=<32+ random characters; generate with openssl rand -base64 32>
```

`createMythos()` validates the session secret, API URL and listing configuration when the SDK instance is created.

---

## Integration checklist

- [ ] `createMythos()` called once at startup with the SDK catch-all mounted
- [ ] Well-known handshake and listing-registration rewrites reach the SDK handlers
- [ ] Browser pages use `useMythos()` for session state, authenticated fetches and automatic handshake
- [ ] Metering uses `mythos.charge(req, ...)`
- [ ] LLM inference uses `await mythos.llm(req, ...)` and `mythos.billing(completion)`; do not meter inference with `reportUsage()`
- [ ] Catch `MythosError` and map its `httpStatus` and `code` to the HTTP response
- [ ] Own auth/paywall (if any) bypassed when `mythos.getSession(req)` returns a session
- [ ] Listing registered with a reachable `launch_url` (HTTPS + real TLD in production)
- [ ] (Optional) Pre-charge confirmation wired for actions that warrant it — see step 5b
