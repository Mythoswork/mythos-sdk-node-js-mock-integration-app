import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { MythosError } from '@mythos-work/sdk';

import { logMythosError } from '../../lib/logger';
import { mythos } from '../../lib/mythos';

const PRODUCER_OPENAI_API_KEY = process.env.PRODUCER_OPENAI_API_KEY;
const MODEL_ID = process.env.ALPHA_MODEL_ID ?? 'openai/gpt-4o-mini';
const STANDALONE_MODEL_ID = MODEL_ID.replace(/^openrouter\//, '');
const STANDALONE_BASE_URL = 'https://openrouter.ai/api/v1';

interface BillingPayload {
  creditsCharged: number | null;
  mythosCostMicrounits: string | null;
  mythosPricingSource: string | null;
  billingStatus: string | null;
}

interface HttpError {
  status: number;
  error: string;
  code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Maps a thrown error to the status + message the browser should see. Used as a JSON envelope
// before any SSE frame is written, and as an `error` frame once the stream has started.
function toHttpError(err: unknown): HttpError {
  if (err instanceof MythosError) {
    if (err.httpStatus >= 500) logMythosError(`chat: SDK request failed (${err.code})`, err);
    return { status: err.httpStatus, error: err.message, code: err.code };
  }
  // The Mythos gateway answers with an OpenAI-shaped error envelope, which the OpenAI client
  // surfaces as an APIError carrying the upstream status.
  if (err instanceof OpenAI.APIError) {
    if (err.status === 402) return { status: 402, error: 'Insufficient credits', code: 'INSUFFICIENT_FUNDS' };
    if (err.status === 401) return { status: 401, error: 'Mythos session expired', code: 'SESSION_EXPIRED' };
  }
  logMythosError('chat: upstream request failed', err);
  return { status: 502, error: 'Chat request failed' };
}

function sendError(res: NextApiResponse, err: unknown): void {
  const { status, error, code } = toHttpError(err);
  res.status(status).json({ success: false, error, ...(code ? { code } : {}) });
}

function writeEvent(res: NextApiResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function toBillingPayload(response: unknown): BillingPayload | null {
  const billing = mythos.billing(response);
  if (!billing) return null;
  return {
    creditsCharged: billing.mythos_charge_credits ?? null,
    mythosCostMicrounits: billing.mythos_cost_microunits ?? null,
    mythosPricingSource: billing.mythos_pricing_source ?? null,
    billingStatus: billing.mythos_billing_status ?? null,
  };
}

async function replyJson(
  res: NextApiResponse,
  client: OpenAI,
  model: string,
  message: string,
  isMythos: boolean,
  signal: AbortSignal,
): Promise<void> {
  const completion = await client.chat.completions.create(
    { model, messages: [{ role: 'user', content: message }], stream: false },
    { signal },
  );
  const billing = isMythos ? toBillingPayload(completion) : null;
  res.status(200).json({
    success: true,
    data: {
      reply: completion.choices[0]?.message.content ?? null,
      creditsCharged: billing?.creditsCharged ?? null,
      mythosCostMicrounits: billing?.mythosCostMicrounits ?? null,
      mythosPricingSource: billing?.mythosPricingSource ?? null,
      billingStatus: billing?.billingStatus ?? null,
    },
  });
}

// Relays the provider stream to the browser as this app's own SSE frames:
// `data: {"type":"delta","content":"..."}`, an optional `data: {"type":"billing",...}` frame,
// then `data: [DONE]`. The Mythos gateway settles streamed calls server-side and does not put
// billing metadata on SSE chunks, so the billing frame normally never appears -- it is
// forwarded only if a chunk ever carries it.
async function relayStream(
  res: NextApiResponse,
  stream: AsyncIterable<unknown>,
  isMythos: boolean,
  signal: AbortSignal,
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let billing: BillingPayload | null = null;
  try {
    for await (const chunk of stream) {
      if (isMythos) billing = toBillingPayload(chunk) ?? billing;

      const choices = isRecord(chunk) ? chunk['choices'] : undefined;
      if (!Array.isArray(choices) || choices.length === 0) continue;
      const delta = isRecord(choices[0]) ? choices[0]['delta'] : undefined;
      const content = isRecord(delta) ? delta['content'] : undefined;
      if (typeof content === 'string' && content.length > 0) writeEvent(res, { type: 'delta', content });
    }
    if (billing) writeEvent(res, { type: 'billing', ...billing });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: unknown) {
    // Browser disconnected: the socket is gone and the gateway has already parked the
    // request for reconciliation, so there is nothing left to write.
    if (signal.aborted) return;
    // Headers are on the wire, so a JSON envelope is no longer possible -- send an error frame.
    const { error, code } = toHttpError(err);
    try {
      writeEvent(res, { type: 'error', error, ...(code ? { code } : {}) });
    } catch {
      // Socket already closed.
    }
    if (!res.writableEnded) res.end();
  }
}

export default async function chat(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const body = isRecord(req.body) ? req.body : {};
  const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
  // The UI toggle picks the wire format: absent/false keeps the single-JSON contract, true
  // switches to SSE.
  const streaming = body['stream'] === true;

  if (!message) {
    res.status(400).json({ success: false, error: 'Missing message' });
    return;
  }
  if (!PRODUCER_OPENAI_API_KEY) {
    logMythosError('chat: PRODUCER_OPENAI_API_KEY is not set', new Error('Missing provider API key'));
    res.status(500).json({ success: false, error: 'Server misconfigured: PRODUCER_OPENAI_API_KEY not set' });
    return;
  }

  // Abort the upstream call if the browser disconnects, so nobody pays for tokens no one reads.
  // `close` also fires on normal completion, so only abort while the response is unfinished.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    // Same endpoint for both modes: with a Mythos session the SDK returns the gateway client
    // (billed to the Consumer's credits); without one it returns the standalone fallback.
    const session = await mythos.getSession(req);
    const client = await mythos.llm<OpenAI>(req, {
      apiKey: PRODUCER_OPENAI_API_KEY,
      fallback: new OpenAI({ apiKey: PRODUCER_OPENAI_API_KEY, baseURL: STANDALONE_BASE_URL }),
    });
    const isMythos = session !== null;
    const model = isMythos ? MODEL_ID : STANDALONE_MODEL_ID;

    if (!streaming) {
      await replyJson(res, client, model, message, isMythos, controller.signal);
      return;
    }

    const stream = await client.chat.completions.create(
      {
        model,
        messages: [{ role: 'user', content: message }],
        stream: true,
        // The Mythos gateway forces this server-side; set it so the standalone path matches.
        stream_options: { include_usage: true },
      },
      { signal: controller.signal },
    );
    await relayStream(res, stream, isMythos, controller.signal);
  } catch (err: unknown) {
    if (controller.signal.aborted || res.headersSent) return;
    sendError(res, err);
  }
}
