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

interface BillingPayload {
  creditsCharged: number | null;
  mythosCostMicrounits: string | null;
  mythosPricingSource: string | null;
  billingStatus: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Maps a thrown error to the HTTP status + message the client should see. Used only for
// failures raised *before* any SSE frame has been written -- once headers are on the wire a
// JSON error envelope is no longer possible, so the stream emits an `error` frame instead.
function toHttpError(err: unknown): { status: number; error: string } {
  if (err instanceof InsufficientFundsError) {
    return { status: 402, error: 'Insufficient funds' };
  }
  if (err instanceof SessionNotFoundError) {
    return { status: 404, error: 'Session not found' };
  }
  if (err instanceof InvalidLaunchTokenError) {
    return { status: 401, error: 'Invalid launch token' };
  }
  if (err instanceof MythosError) {
    return { status: 500, error: 'Chat service is misconfigured' };
  }
  // The Mythos gateway returns an OpenAI-shaped error envelope, which the OpenAI client
  // surfaces as an APIError carrying the upstream status (402/404/401 map to the same
  // conditions the SDK error types above cover).
  if (err instanceof OpenAI.APIError) {
    if (err.status === 402) return { status: 402, error: 'Insufficient funds' };
    if (err.status === 404) return { status: 404, error: 'Session not found' };
    if (err.status === 401) return { status: 401, error: 'Invalid launch token' };
  }
  return { status: 502, error: 'Chat request failed' };
}

function writeEvent(res: NextApiResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function extractBilling(chunk: unknown): BillingPayload | null {
  const billing = getLlmBillingMetadata(chunk);
  if (!billing) return null;
  return {
    creditsCharged: billing.mythos_charge_credits ?? null,
    mythosCostMicrounits: billing.mythos_cost_microunits,
    mythosPricingSource: billing.mythos_pricing_source,
    billingStatus: billing.mythos_billing_status ?? null,
  };
}

export default async function chat(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const body = isRecord(req.body) ? req.body : {};
  const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
  // The UI toggle decides which wire format it wants. Absent/false keeps the original
  // single-JSON-response contract; true switches to OpenAI-style SSE.
  const streaming = body['stream'] === true;

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

  // Abort the upstream provider call if the browser disconnects mid-request, so the gateway
  // can stop paying for tokens nobody will read. `close` also fires on normal completion, so
  // only abort when the response has not already ended.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  let client: OpenAI;
  let model: string;
  let isStandalone: boolean;
  try {
    const session = cookieValue ? decodeSession(cookieValue) : null;
    isStandalone = !session;
    model = isStandalone ? STANDALONE_MODEL_ID : MODEL_ID;
    client = llm<OpenAI>(session, {
      apiKey: PRODUCER_OPENAI_API_KEY,
      fallback: new OpenAI({ apiKey: PRODUCER_OPENAI_API_KEY, baseURL: STANDALONE_BASE_URL }),
    });
  } catch (err: unknown) {
    if (controller.signal.aborted) return;
    const { status, error } = toHttpError(err);
    res.status(status).json({ success: false, error });
    return;
  }

  if (!streaming) {
    // Non-streaming: a single JSON reply. This is the only mode that can read the Mythos
    // billing metadata back off the response.
    try {
      const completion = await client.chat.completions.create(
        {
          model,
          messages: [{ role: 'user', content: message }],
          stream: false,
        },
        { signal: controller.signal },
      );
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
      if (controller.signal.aborted) return;
      const { status, error } = toHttpError(err);
      res.status(status).json({ success: false, error });
    }
    return;
  }

  let stream: AsyncIterable<unknown>;
  try {
    stream = await client.chat.completions.create(
      {
        model,
        messages: [{ role: 'user', content: message }],
        stream: true,
        // Ask the provider for a final usage frame. The Mythos gateway forces this on
        // server-side anyway; setting it explicitly keeps the standalone OpenRouter path
        // consistent, and a streaming caller that never reads usage simply ignores it.
        stream_options: { include_usage: true },
      },
      { signal: controller.signal },
    );
  } catch (err: unknown) {
    // Browser disconnected before the stream opened -- the socket is gone, so there is
    // nothing to answer with.
    if (controller.signal.aborted) return;
    // Nothing has been written yet -- a normal JSON error is still possible.
    const { status, error } = toHttpError(err);
    res.status(status).json({ success: false, error });
    return;
  }

  // OpenAI-compatible SSE frames, so the same wire format the gateway itself emits is what
  // the browser reads: `data: {"type":"delta","content":"..."}`, an optional
  // `data: {"type":"billing",...}` frame, then `data: [DONE]`.
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
      // Future-proofing: if the gateway ever attaches Mythos billing metadata to a stream
      // frame, forward it so the client's ledger still updates. Today's gateway only bills
      // streaming calls server-side (see litellm-gateway.service.ts recordStreamingChatUsage)
      // and leaves the SSE frames provider-shaped, so this normally stays null.
      const chunkBilling = extractBilling(chunk);
      if (chunkBilling) billing = chunkBilling;

      const choices = isRecord(chunk) ? chunk['choices'] : undefined;
      if (!Array.isArray(choices) || choices.length === 0) continue;

      const delta = isRecord(choices[0]) ? choices[0]['delta'] : undefined;
      const content = isRecord(delta) ? delta['content'] : undefined;
      if (typeof content === 'string' && content.length > 0) {
        writeEvent(res, { type: 'delta', content });
      }
    }

    if (billing) writeEvent(res, { type: 'billing', ...billing });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: unknown) {
    // Client aborted: the connection is already gone and the gateway has moved its ledger
    // row to usage_pending, so there is nothing to write here.
    if (controller.signal.aborted) return;

    // Headers are already on the wire, so a JSON error envelope is no longer possible --
    // close the SSE stream with an error frame the client can surface.
    const { error } = toHttpError(err);
    try {
      writeEvent(res, { type: 'error', error });
    } catch {
      // Socket already closed -- nothing left to do.
    }
    if (!res.writableEnded) res.end();
  }
}
