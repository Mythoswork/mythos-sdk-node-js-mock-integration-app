import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import {
  decodeSession,
  InsufficientFundsError,
  InvalidLaunchTokenError,
  MythosError,
  SessionNotFoundError,
} from '@mythos-work/sdk';
import { getLlmBillingMetadata, llm } from '@mythos-work/sdk/llm';

import { SESSION_COOKIE_NAME } from '../../lib/session-cookie';

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
    res.status(500).json({ success: false, error: 'Server misconfigured: PRODUCER_OPENAI_API_KEY not set' });
    return;
  }

  // One endpoint either way, same as /api/calculate: with a Mythos session (from the
  // cookie /api/verify-session set), llm()'s returned client is routed through the Mythos
  // gateway and billed. Without one -- this app's own standalone demo mode -- llm()'s
  // fallback returns a plain OpenAI client instead. Only the model id and billing
  // metadata differ; the client never needs to know or choose which mode it's in.
  const cookieValue = req.cookies[SESSION_COOKIE_NAME];

  try {
    const session = cookieValue ? decodeSession(cookieValue) : null;
    const isStandalone = !session;
    const client = llm<OpenAI>(session, {
      apiKey: PRODUCER_OPENAI_API_KEY,
      fallback: new OpenAI({ apiKey: PRODUCER_OPENAI_API_KEY, baseURL: STANDALONE_BASE_URL }),
    });
    const completion = await client.chat.completions.create({
      model: isStandalone ? STANDALONE_MODEL_ID : MODEL_ID,
      messages: [{ role: 'user', content: message }],
      stream: false,
    });
    const billing = isStandalone ? null : getLlmBillingMetadata(completion);

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
    if (err instanceof InsufficientFundsError) {
      res.status(402).json({ success: false, error: 'Insufficient funds' });
      return;
    }
    if (err instanceof SessionNotFoundError) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }
    if (err instanceof InvalidLaunchTokenError) {
      res.status(401).json({ success: false, error: 'Invalid launch token' });
      return;
    }
    if (err instanceof MythosError) {
      res.status(500).json({ success: false, error: 'Chat service is misconfigured' });
      return;
    }
    res.status(502).json({ success: false, error: 'Chat request failed' });
  }
}
