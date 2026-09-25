import type { NextApiRequest, NextApiResponse } from 'next';
import { MythosError } from '@mythos-work/sdk';

import { logMythosError } from '../../lib/logger';
import { mythos } from '../../lib/mythos';
import { CREDITS_PER_CALCULATION } from '../../lib/pricing';

type Operation = 'add' | 'subtract' | 'multiply' | 'divide';

function compute(operation: Operation, a: number, b: number): number {
  switch (operation) {
    case 'add':
      return a + b;
    case 'subtract':
      return a - b;
    case 'multiply':
      return a * b;
    case 'divide':
      return a / b;
  }
}

export default async function calculate(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const body = req.body as { operation?: Operation; a?: number; b?: number };
  const { operation, a, b } = body;

  if (!operation || typeof a !== 'number' || typeof b !== 'number') {
    res.status(400).json({ success: false, error: 'Missing operation, a, or b' });
    return;
  }

  if (operation === 'divide' && b === 0) {
    res.status(400).json({ success: false, error: 'Division by zero' });
    return;
  }

  try {
    const result = compute(operation, a, b);
    await mythos.charge(req, { credits: CREDITS_PER_CALCULATION, reason: `calculator:${operation}` });
    res.status(200).json({ success: true, data: { result, creditsCharged: CREDITS_PER_CALCULATION } });
  } catch (err: unknown) {
    if (err instanceof MythosError) {
      res.status(err.httpStatus).json({ success: false, error: err.message, code: err.code });
      return;
    }
    logMythosError('calculate: unexpected server error', err);
    throw err;
  }
}
