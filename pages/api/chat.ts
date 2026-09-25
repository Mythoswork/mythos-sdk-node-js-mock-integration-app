import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { MythosError } from '@mythos-work/sdk';

import { logMythosError } from '../../lib/logger';
import { mythos } from '../../lib/mythos';

const PRODUCER_OPENAI_API_KEY = process.env.PRODUCER_OPENAI_API_KEY;
const MODEL_ID = process.env.ALPHA_MODEL_ID ?? 'openai/gpt-4o-mini';
const STANDALONE_MODEL_ID = MODEL_ID.replace(/^openrouter\//, '');
const STANDALONE_BASE_URL = 'https://openrouter.ai/api/v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default async function chat(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const body = isRecord(req.body) ? req.body : {};
  const message = typeof body['message'] === 'string' ? body['message'].trim() : '';

  if (!message) {
    res.status(400).json({ success: false, error: 'Missing message' });
    return;
  }
  if (!PRODUCER_OPENAI_API_KEY) {
    logMythosError('chat: PRODUCER_OPENAI_API_KEY is not set', new Error('Missing provider API key'));
    res.status(500).json({ success: false, error: 'Server misconfigured: PRODUCER_OPENAI_API_KEY not set' });
    return;
  }

  try {
    const session = await mythos.getSession(req);
    const client = await mythos.llm<OpenAI>(req, {
      apiKey: PRODUCER_OPENAI_API_KEY,
      fallback: new OpenAI({ apiKey: PRODUCER_OPENAI_API_KEY, baseURL: STANDALONE_BASE_URL }),
    });
    const completion = await client.chat.completions.create({
      model: session ? MODEL_ID : STANDALONE_MODEL_ID,
      messages: [{ role: 'user', content: message }],
      stream: false,
    });
    const billing = session ? mythos.billing(completion) : null;

    res.status(200).json({
      success: true,
      data: {
        reply: completion.choices[0]?.message.content ?? null,
        creditsCharged: billing?.mythos_charge_credits ?? null,
        mythosCostMicrounits: billing?.mythos_cost_microunits ?? null,
        mythosPricingSource: billing?.mythos_pricing_source ?? null,
        billingStatus: billing?.mythos_billing_status ?? null,
      },
    });
  } catch (err: unknown) {
    if (err instanceof MythosError) {
      if (err.httpStatus >= 500) logMythosError(`chat: SDK request failed (${err.code})`, err);
      res.status(err.httpStatus).json({ success: false, error: err.message, code: err.code });
      return;
    }
    logMythosError('chat: upstream request failed', err);
    res.status(502).json({ success: false, error: 'Chat request failed' });
  }
}
