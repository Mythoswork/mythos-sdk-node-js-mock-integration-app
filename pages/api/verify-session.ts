import type { NextApiRequest, NextApiResponse } from 'next';
import type { Request, Response } from 'express';
import { requireLaunchToken, verifyLaunchToken, encodeSession, decodeSession } from '@mythos-work/sdk';
import type { MythosSession } from '@mythos-work/sdk';
import { getListingIds } from '../../lib/listing-ids-store';
import { SESSION_COOKIE_MAX_AGE_SECONDS, SESSION_COOKIE_NAME } from '../../lib/session-cookie';

const handler = requireLaunchToken({ resolveListingIds: getListingIds });

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
    const secureAttribute = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}${secureAttribute}`,
    );

    res.status(200).json({ success: true, data: publicSessionOf(session) });
  });
}
