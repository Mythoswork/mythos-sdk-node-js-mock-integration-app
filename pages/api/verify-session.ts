import type { NextApiRequest, NextApiResponse } from 'next';
import type { Request, Response } from 'express';
import { requireLaunchToken, verifyLaunchToken, encodeSession, decodeSession } from '@mythos-work/sdk';
import type { MythosSession } from '@mythos-work/sdk';
import { requireSessionSecret } from '../../lib/config';
import { getListingIds } from '../../lib/listing-ids-store';
import { SESSION_COOKIE_MAX_AGE_SECONDS, SESSION_COOKIE_NAME } from '../../lib/session-cookie';

const handler = requireLaunchToken({ resolveListingIds: getListingIds });
requireSessionSecret();

function publicSessionOf(session: MythosSession): MythosSession {
  const publicSession = { ...session };
  delete publicSession.llmIdentityToken;
  delete publicSession.llmIdentityExpiresAt;
  return publicSession;
}

export default async function verifySession(req: NextApiRequest, res: NextApiResponse) {
  // The launch token is single-use. If this app's own session cookie is already valid,
  // reuse it instead of calling requireLaunchToken() again -- otherwise navigating between
  // this app's own pages (e.g. /calculator -> /llm) with the same `lt` would fail the
  // second time with "already consumed".
  const existingCookie = req.cookies[SESSION_COOKIE_NAME];
  const existingSession = existingCookie ? decodeSession(existingCookie) : null;

  const rawLt = req.query['lt'];
  const lt = typeof rawLt === 'string' ? rawLt : Array.isArray(rawLt) ? rawLt[0] : undefined;

  if (existingSession) {
    // A cookie only proves *some* session was consumed already -- not that it's the one
    // this request's `lt` refers to. Trusting it unconditionally meant a fresh Mythos
    // re-launch (a new `lt` for a new session row) while an older cookie was still within
    // its TTL would never get consumed, leaving that new session's row permanently
    // unconsumed and every later meter() call on it 409 with SESSION_NOT_STARTED.
    let sameSessionAsCookie = !lt;
    if (lt) {
      try {
        const incoming = await verifyLaunchToken(lt, { resolveListingIds: getListingIds });
        sameSessionAsCookie = incoming.sessionJti === existingSession.sessionJti;
      } catch {
        // Malformed/expired `lt` alongside a still-good cookie for a different session --
        // keep trusting the cookie rather than failing a page that may not even need `lt`.
        sameSessionAsCookie = true;
      }
    }
    if (sameSessionAsCookie) {
      res.status(200).json({ success: true, data: publicSessionOf(existingSession) });
      return;
    }
    // Different session than the cookie -- fall through and consume it fresh below.
  }

  return handler(req as unknown as Request, res as unknown as Response, () => {
    const session = (req as unknown as { mythos: MythosSession }).mythos;

    // Encrypts the full session (including the LLM identity token) into this app's own
    // HttpOnly cookie, so any other route on this app -- /api/chat, or any future
    // endpoint -- can read it back via decodeSession() without ever touching Mythos's
    // single-use /consume endpoint again.
    const cookieValue = encodeSession(session);
    // This app runs inside the Mythos dashboard's iframe -- a cross-site context. SameSite=Lax
    // cookies are never sent there, so every page switch (e.g. /calculator -> /llm) re-consumed
    // the single-use `lt` and failed with "Token already consumed". SameSite=None requires
    // Secure; Partitioned (CHIPS) keeps it working when the browser blocks third-party cookies.
    // Plain local dev (http, not embedded) keeps Lax since Secure cookies need HTTPS.
    const crossSiteAttributes =
      process.env.NODE_ENV === 'production' ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax';
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${cookieValue}; Path=/; HttpOnly; ${crossSiteAttributes}; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`,
    );

    res.status(200).json({ success: true, data: publicSessionOf(session) });
  });
}
