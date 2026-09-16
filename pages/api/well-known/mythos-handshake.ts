import type { NextApiRequest, NextApiResponse } from 'next';
import type { Request, Response } from 'express';
import { handshakeRoute } from '@mythos-work/sdk';

const handler = handshakeRoute();

export default function mythosHandshake(req: NextApiRequest, res: NextApiResponse) {
  return handler(req as unknown as Request, res as unknown as Response, () => {});
}
