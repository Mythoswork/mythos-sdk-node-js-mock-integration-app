import type { NextApiRequest, NextApiResponse } from 'next';
import type { Request, Response } from 'express';
import { listingCallbackRoute } from '@mythos-work/sdk';
import { addListingId } from '../../../lib/listing-ids-store';

const handler = listingCallbackRoute(async (listingId) => {
  await addListingId(listingId);
});

export default function mythosListingRegistered(req: NextApiRequest, res: NextApiResponse) {
  return handler(req as unknown as Request, res as unknown as Response, () => {});
}
