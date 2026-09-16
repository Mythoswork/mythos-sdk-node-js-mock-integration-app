import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getLlmBillingMetadata,
  InvalidLaunchTokenError,
  llm,
  MythosConfigError,
  MythosError,
  verifyLaunchToken,
} from '@mythos-work/sdk';

import { getListingIds } from '../../lib/listing-ids-store';
import { getMythosSession } from '../../lib/mythos-session-store';

const PRODUCER_OPENAI_API_KEY = process.env.PRODUCER_OPENAI_API_KEY;
const MODEL_ID = process.env.ALPHA_MODEL_ID ?? 'openai/gpt-4o-mini';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default async function chat(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const body = isRecord(req.body) ? req.body : {};
  const launchToken = typeof body['lt'] === 'string' ? body['lt'] : '';
  const message = typeof body['message'] === 'string' ? body['message'].trim() : '';

  if (!launchToken || !message) {
    res.status(400).json({ success: false, error: 'Missing lt or message' });
    return;
  }
  if (!PRODUCER_OPENAI_API_KEY) {
    res.status(500).json({ success: false, error: 'Server misconfigured: PRODUCER_OPENAI_API_KEY not set' });
    return;
  }

  try {
    const verifiedSession = await verifyLaunchToken(launchToken, { resolveListingIds: getListingIds });
    const session = getMythosSession(launchToken);
    if (!session || session.sessionJti !== verifiedSession.sessionJti) {
      res.status(401).json({ success: false, error: 'Mythos session is not initialized' });
      return;
    }

    const client = llm(session, { apiKey: PRODUCER_OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: MODEL_ID,
      messages: [{ role: 'user', content: message }],
      stream: false,
    });
    const billing = getLlmBillingMetadata(completion);

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
    if (err instanceof InvalidLaunchTokenError) {
      res.status(401).json({ success: false, error: 'Invalid launch token' });
      return;
    }
    if (err instanceof MythosConfigError || err instanceof MythosError) {
      res.status(500).json({ success: false, error: 'Chat service is misconfigured' });
      return;
    }
    res.status(502).json({ success: false, error: 'Chat request failed' });
  }
}
