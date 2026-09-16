# Mythos Calculator Mockup

Reference/worked example of a **Producer** (third-party SaaS) integration with the Mythos marketplace. This is a disposable calculator app that exists only to prove the full `@mythos-work/sdk` contract end-to-end against a real running `mythos-backend`. Copy the pattern, not the calculator.

If you're integrating your own SaaS with Mythos, this doc is the part that matters — everything else in this repo is throwaway demo scaffolding (harness login page, fake standalone auth, etc).

---

## What "integrating with Mythos" actually means

Your app is a **Producer**. Mythos (the marketplace/FE) sends users to your app in an iframe with a signed `?lt=<token>` query param. Your job:

1. Prove you're alive (handshake) — once, at listing-registration time.
2. Verify + consume the launch token — once, on load.
3. Tell the parent frame you're ready (`postMessage`) — once, right after step 2 succeeds.
4. Meter calculator usage with `reportUsage`, and route LLM inference through the SDK client.

None of this requires you to know anything about Mythos users, passwords, or sessions beyond what's in the signed token. You never see a Mythos password. You never call Mythos except through the SDK.

---

## 1. Install the SDK

```bash
npm install @mythos-work/sdk
```

(This repo pins a local `file:` tarball since the SDK isn't published yet — see `package.json`. A real integration would use the published package.)

---

## 2. Implement the handshake route (required, checked once at listing registration)

Mythos calls `POST /api/listings/web-app` (from your side, someone registers your app as a listing) → backend synchronously calls **your** `launch_url` + `/.well-known/mythos-handshake` with a short-lived signed check token, 5s timeout. If this fails, your listing registration fails outright.

```ts
// pages/api/well-known/mythos-handshake.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { handshakeRoute } from '@mythos-work/sdk';

const handler = handshakeRoute();

export default function mythosHandshake(req: NextApiRequest, res: NextApiResponse) {
  return handler(req as any, res as any, () => {});
}
```

Must be reachable at `<launch_url origin>/.well-known/mythos-handshake` — not under your app's own auth, this runs before any user session exists.

---

## 3. Verify + consume the launch token (required, exactly once per launch)

When your app loads with `?lt=<token>`, call this **exactly once** — it atomically consumes the session server-side (DB-enforced single-use, not in-memory). Calling it twice on the same `lt` fails the second time with "already consumed."

```ts
// pages/api/verify-session.ts
import { requireLaunchToken } from '@mythos-work/sdk';

const handler = requireLaunchToken();

export default function verifySession(req, res) {
  return handler(req, res, () => {
    const session = req.mythos; // { userId, email, displayName, listingId, sessionJti }
    res.status(200).json({ success: true, data: session });
  });
}
```

Do this once on mount (`pages/calculator.tsx` calls it from a `useEffect` keyed on `lt`, guarded by a ref so it can't double-fire on re-render).

---

## 4. Tell the parent frame you're ready (required — easy to miss, breaks silently)

**This step is not optional and is not obvious from the SDK types.** After step 3 succeeds, the Mythos FE is waiting for a `postMessage` from your iframe to know your app actually loaded and authenticated. If you never send it, the FE shows a generic "app did not respond" timeout after 5s — even though your app loaded fine, auth worked, and everything else is correct. There's no compile-time or SDK-level check that catches this; it only shows up as a silent FE-side timeout.

```ts
// after verify-session succeeds, client-side:
window.parent.postMessage({ type: 'mythos:handshake' }, '*');
```

Use a real target origin (not `'*'`) in production — scope it to the known Mythos marketplace origin once you have it, `'*'` here is a demo-only shortcut.

---

## 5. Meter usage (required for any billable operation)

Do **not** call `requireLaunchToken()` again for this — it consumes, and you already consumed once in step 3. Use the non-consuming `verifyLaunchToken()` to re-validate the still-live `lt`, then report usage:

```ts
// pages/api/calculate.ts
import { verifyLaunchToken, reportUsage, InsufficientFundsError, SessionNotFoundError } from '@mythos-work/sdk';

const session = await verifyLaunchToken(lt);
const result = doTheWork();
await reportUsage(session.sessionJti, { credits: 1, reason: 'calculator:add' });
```

- `reportUsage` charges credits from the user's wallet immediately — real money-equivalent movement, not a log entry.
- Catch `InsufficientFundsError` → surface as HTTP 402 to your frontend, don't let it bubble as a generic 500.
- Catch `SessionNotFoundError` → the `lt` expired (5 min from mint) or was never valid.
- Charge whatever `credits` value makes sense per operation — the SDK doesn't enforce a fixed price, that's entirely up to you.

---

## 5a. Use SDK-owned LLM inference

LLM inference is different from calculator work: do not call `reportUsage` and do not send a
client-supplied credit amount. Keep the full `MythosSession` returned by the server-side
`requireLaunchToken()` handler, then create the official OpenAI client on your server:

```ts
import { getLlmBillingMetadata, llm } from '@mythos-work/sdk';

const client = llm(session, { apiKey: process.env.PRODUCER_OPENAI_API_KEY });
const completion = await client.chat.completions.create({
  model: 'openai/gpt-4o-mini',
  messages: [{ role: 'user', content: message }],
});
const billing = getLlmBillingMetadata(completion);
```

The SDK sends the provider key and session identity to Mythos. The gateway observes provider
usage, settles the charge, and returns billing metadata. This mockup stores the identity-bearing
session only in its server-side session cache; the browser receives only public session fields.

---

## 6. Bypass your own auth/paywall when `lt` is present

If your app also has its own independent login/subscription for direct (non-Mythos) traffic, branch on `lt` **before** any of that runs:

```ts
if (!lt) {
  // no Mythos session at all — this is direct traffic, run your own auth/paywall
  return <YourOwnLoginAndPaywallFlow />;
}
// lt present — skip your own gate entirely, go straight to steps 3–5 above
```

These are two totally separate, non-linked identity systems. A user authenticated via Mythos gets access through Mythos credits, full stop — regardless of whether they also happen to have (or don't have) an account in your own system.

---

## 5b. Pre-charge confirmation (required)

Before firing any billable action, gate the client-side call to your own metering endpoint
behind a `postMessage` round trip with the Mythos dashboard (`window.parent`), instead of
calling it unconditionally — the Consumer must explicitly approve every charge. This app
demonstrates that pattern in `lib/confirm-charge.ts`, wired up unconditionally in
`pages/calculator.tsx`'s `handleCalculate`:

```ts
// lib/confirm-charge.ts — adapted from mythos-sdk/docs/examples/mythos-client.ts.
// Resolves false (never rejects) on timeout, decline, or if not embedded — fail-closed.
const approved = await confirmCharge(1, `${operation}(${a}, ${b})`);
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
```

The SDK reads `MYTHOS_LISTING_ID` per-request (not cached) to validate the `aud` claim on incoming tokens — make sure it's set before any `verifyLaunchToken`/`requireLaunchToken` call runs.

---

## Integration checklist

- [ ] `/.well-known/mythos-handshake` implemented via `handshakeRoute()`, reachable without auth
- [ ] `requireLaunchToken()` called exactly once per launch, on load
- [ ] `window.parent.postMessage({type: 'mythos:handshake'}, ...)` sent right after that succeeds
- [ ] Metering uses `verifyLaunchToken()` (non-consuming) + `reportUsage()`, not a second `requireLaunchToken()` call
- [ ] LLM inference uses `llm(session, { apiKey })`; do not call `reportUsage()` for inference
- [ ] `InsufficientFundsError` / `SessionNotFoundError` mapped to sane HTTP responses, not generic 500s
- [ ] Own auth/paywall (if any) fully bypassed when `lt` is present
- [ ] Listing registered with a reachable `launch_url` (HTTPS + real TLD in production)
- [ ] (Optional) Pre-charge confirmation wired for actions that warrant it — see step 5b
