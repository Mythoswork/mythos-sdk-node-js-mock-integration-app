import type { NextApiRequest, NextApiResponse } from 'next';
import type { Request, Response } from 'express';
import { requireLaunchToken } from '@mythos-work/sdk';
import type { MythosSession } from '@mythos-work/sdk';
import { getListingIds } from '../../lib/listing-ids-store';
import { rememberMythosSession } from '../../lib/mythos-session-store';

const handler = requireLaunchToken({ resolveListingIds: getListingIds });

export default function verifySession(req: NextApiRequest, res: NextApiResponse) {
  return handler(req as unknown as Request, res as unknown as Response, () => {
    const session = (req as unknown as { mythos: MythosSession }).mythos;
    const launchToken = Array.isArray(req.query.lt) ? req.query.lt[0] : req.query.lt;
    if (typeof launchToken !== 'string') {
      res.status(400).json({ success: false, error: 'Missing launch token' });
      return;
    }

    // Keep the identity credential server-side. The browser only receives the
    // non-sensitive session details needed to render the page.
    rememberMythosSession(launchToken, session);
    const publicSession = { ...session };
    delete publicSession.llmIdentityToken;
    delete publicSession.llmIdentityExpiresAt;
    res.status(200).json({ success: true, data: publicSession });
  });
}
