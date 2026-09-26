import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import type { MythosSession } from '@mythos-work/sdk';
import { confirmCharge, sendHandshake } from '@mythos-work/sdk/client';
import { estimateChatCredits } from '@/lib/pricing';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Fake standalone SaaS credentials — this is a demo gate only, not real auth.
const STANDALONE_USERNAME = 'demo';
const STANDALONE_PASSWORD = 'demo';

export default function LlmPage() {
  const router = useRouter();
  const lt = typeof router.query.lt === 'string' ? router.query.lt : undefined;

  const verifyStarted = useRef(false);
  const [session, setSession] = useState<MythosSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Standalone (non-Mythos) gate state — only relevant when there's no Mythos session at all.
  const [standaloneUsername, setStandaloneUsername] = useState('');
  const [standalonePassword, setStandalonePassword] = useState('');
  const [standaloneLoginError, setStandaloneLoginError] = useState<string | null>(null);
  const [isStandaloneLoggedIn, setIsStandaloneLoggedIn] = useState(false);
  const [isStandalonePaid, setIsStandalonePaid] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [creditsChargedTotal, setCreditsChargedTotal] = useState(0);
  const [lastCost, setLastCost] = useState<{
    credits: number | null;
    microunits: string | null;
    source: string | null;
    status: string | null;
  } | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // UI toggle: stream the reply token-by-token, or wait for the single JSON response.
  // Non-streaming is the only mode that receives the settled Mythos billing numbers.
  const [streamingEnabled, setStreamingEnabled] = useState(true);
  const chatLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Keep the newest streamed tokens in view while the assistant reply grows.
    chatLogRef.current?.scrollTo({ top: chatLogRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    // router.isReady guards against Next's Pages Router not having parsed the query
    // string yet on first render -- without this, the very first verify attempt can fire
    // with `lt` still undefined even though it's right there in the URL, and since
    // verifyStarted latches immediately, that bad attempt is never retried.
    if (!router.isReady || verifyStarted.current) return;
    verifyStarted.current = true;

    // No `lt` is fine here -- the session cookie from an earlier page (e.g. /calculator)
    // already covers it; /api/verify-session checks that cookie before ever needing `lt`.
    const url = lt ? `/api/verify-session?lt=${encodeURIComponent(lt)}` : '/api/verify-session';
    fetch(url)
      .then((res) => res.json())
      .then((body) => {
        if (body.success) {
          setSession(body.data);
          sendHandshake();
        } else {
          setSessionError(body.error ?? 'Session verification failed');
        }
      })
      .catch((err) => setSessionError(String(err)));
  }, [lt, router.isReady]);

  function handleStandaloneLogin() {
    setStandaloneLoginError(null);
    if (standaloneUsername === STANDALONE_USERNAME && standalonePassword === STANDALONE_PASSWORD) {
      setIsStandaloneLoggedIn(true);
    } else {
      setStandaloneLoginError('Invalid username or password.');
    }
  }

  async function handleSend() {
    const message = input.trim();
    if (!message || isSubmitting) return;

    setChatError(null);
    setIsSubmitting(true);

    try {
      // Same confirm-charge modal calculator.tsx already uses, before any Mythos-billed
      // action. The credits number here is a rough, message-length-based reminder, not a
      // projection of the real LLM cost (that's only known after the provider responds,
      // and is already billed automatically by /api/chat via the SDK's wallet hold) -- it
      // exists purely so the Consumer intentionally confirms before spending anything, and
      // so the number isn't a meaningless hardcoded stub. Skipped entirely in standalone
      // mode (no `session`), same as calculator's own precedent.
      if (session) {
        const approved = await confirmCharge(
          estimateChatCredits(message),
          `chat: "${message.slice(0, 40)}"`,
          undefined,
          'llm',
        );
        if (!approved) {
          setChatError(
            'Charge declined, timed out, or the dashboard is not listening — check the console for details.',
          );
          return;
        }
      }

      // Optimistic placeholder: the assistant bubble starts empty and is filled either
      // token-by-token (streaming) or all at once when the JSON reply lands.
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: message },
        { role: 'assistant', content: '' },
      ]);
      setInput('');

      // Always the same endpoint -- /api/chat decides Mythos-billed vs. standalone by
      // whether the session cookie is present, the same way /api/calculate always just
      // takes `lt`. The client never needs to know or choose which mode it's in; the
      // `stream` flag only selects the response wire format.
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, stream: streamingEnabled }),
      });

      if (streamingEnabled) {
        await consumeStream(res);
      } else {
        await consumeJson(res);
      }

      // A reply that never produced any content (empty stream, empty completion) should not
      // leave an empty bubble behind.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.content === '') return prev.slice(0, -1);
        return prev;
      });
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
      // Drop the assistant bubble we optimistically created if it never received content.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.content === '') return prev.slice(0, -1);
        return prev;
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function readErrorMessage(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      // Response body wasn't JSON -- keep the generic message.
    }
    return 'Chat request failed';
  }

  // Streaming mode: consume OpenAI-compatible SSE frames and append each `delta` to the
  // in-flight assistant bubble.
  async function consumeStream(res: Response): Promise<void> {
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !contentType.includes('text/event-stream') || !res.body) {
      // Pre-stream failure (bad request, insufficient funds, misconfigured server, ...):
      // /api/chat answers those with a JSON envelope even in streaming mode.
      setChatError(await readErrorMessage(res));
      return;
    }

    const appendDelta = (text: string) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        const next = [...prev];
        next[next.length - 1] = { ...last, content: last.content + text };
        return next;
      });
    };

    const handleEvent = (data: string) => {
      if (data === '[DONE]') return;
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        return; // Ignore keep-alives / unparseable frames.
      }
      if (typeof event !== 'object' || event === null) return;
      const record = event as Record<string, unknown>;

      if (record['type'] === 'delta' && typeof record['content'] === 'string') {
        appendDelta(record['content']);
      } else if (record['type'] === 'billing') {
        applyBilling(record);
      } else if (record['type'] === 'error' && typeof record['error'] === 'string') {
        setChatError(record['error']);
      }
    };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const drainBuffer = () => {
      // SSE frames are separated by a blank line. Only whole frames can be parsed --
      // anything after the last separator stays buffered for the next read.
      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) handleEvent(line.slice(5).trimStart());
        }
        separator = buffer.indexOf('\n\n');
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drainBuffer();
    }
    buffer += decoder.decode();
    drainBuffer();
  }

  // Non-streaming mode: a single JSON reply -- the only mode that carries the settled Mythos
  // billing numbers back to the client.
  async function consumeJson(res: Response): Promise<void> {
    if (!res.ok) {
      setChatError(await readErrorMessage(res));
      return;
    }
    const body = await res.json();
    if (!body.success) {
      setChatError(body.error);
      return;
    }
    const reply: string = body.data.reply ?? '';
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant') return prev;
      const next = [...prev];
      next[next.length - 1] = { ...last, content: reply };
      return next;
    });
    if (typeof body.data.creditsCharged === 'number') {
      setCreditsChargedTotal((prev) => prev + body.data.creditsCharged);
      setLastCost({
        credits: body.data.creditsCharged,
        microunits: body.data.mythosCostMicrounits ?? null,
        source: body.data.mythosPricingSource ?? null,
        status: body.data.billingStatus ?? null,
      });
    }
  }

  function applyBilling(event: Record<string, unknown>) {
    const credits = typeof event['creditsCharged'] === 'number' ? event['creditsCharged'] : null;
    if (credits !== null) {
      setCreditsChargedTotal((prev) => prev + credits);
    }
    setLastCost({
      credits,
      microunits: typeof event['mythosCostMicrounits'] === 'string' ? event['mythosCostMicrounits'] : null,
      source: typeof event['mythosPricingSource'] === 'string' ? event['mythosPricingSource'] : null,
      status: typeof event['billingStatus'] === 'string' ? event['billingStatus'] : null,
    });
  }

  function renderChatPanel() {
    return (
      <>
        <div className="chatLog" ref={chatLogRef}>
          {messages.length === 0 ? (
            <p className="chatEmpty">No messages yet.</p>
          ) : (
            messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`chatBubble ${message.role === 'user' ? 'chatBubbleUser' : 'chatBubbleAssistant'}`}
              >
                {message.content}
                {message.role === 'assistant' && isSubmitting && index === messages.length - 1 && (
                  <span className="chatCursor" aria-hidden="true" />
                )}
              </div>
            ))
          )}
        </div>

        <label className="chatToggle">
          <input
            type="checkbox"
            checked={streamingEnabled}
            onChange={(e) => setStreamingEnabled(e.target.checked)}
            disabled={isSubmitting}
          />
          <span>Stream response</span>
        </label>
        <p className="chatToggleHint">
          {streamingEnabled
            ? 'Tokens arrive live; settled billing numbers are not included in a stream.'
            : 'Reply arrives all at once, with settled billing numbers.'}
        </p>

        <div className="chatInputRow">
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask something..."
            disabled={isSubmitting}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isSubmitting && input.trim()) void handleSend();
            }}
          />
          <button className="btn btnPrimary" onClick={() => void handleSend()} disabled={isSubmitting || !input.trim()}>
            {isSubmitting ? 'Sending...' : 'Send'}
          </button>
        </div>

        {chatError && <p className="errorText">{chatError}</p>}
        {lastCost && (
          <div className="ledger">
            <div className="ledgerItem">
              <span className="ledgerLabel">Credits charged</span>
              <span className="ledgerValue">{lastCost.credits ?? '?'}</span>
            </div>
            <div className="ledgerItem">
              <span className="ledgerLabel">Real cost</span>
              <span className="ledgerValue">{lastCost.microunits ?? '—'} µu</span>
            </div>
            <div className="ledgerItem">
              <span className="ledgerLabel">Status</span>
              <span className="ledgerValue">{lastCost.status ?? '—'}</span>
            </div>
          </div>
        )}
      </>
    );
  }

  // Standalone (no Mythos at all): only once verify-session has actually been tried and
  // found nothing -- no `lt`, and no session cookie from another page either. Mirrors
  // calculator.tsx's own standalone gate exactly.
  if (!lt && !session && sessionError) {
    if (!isStandaloneLoggedIn) {
      return (
        <>
          <Head>
            <title>Mythos · LLM Chat (standalone)</title>
          </Head>
          <main className="shell llmShell">
            <div className="brandStrip">
              <span className="wordmark">LLM Chat</span>
              <span className="modeLabel">Standalone</span>
            </div>
            <div className="panel authPanel">
              <div className="eyebrow">Direct access</div>
              <div className="identity">
                <h1>Log in</h1>
                <p>No Mythos session detected — use this app&apos;s own account.</p>
              </div>
              {standaloneLoginError && <p className="errorText">{standaloneLoginError}</p>}
              <div className="field" style={{ marginTop: '1.25rem' }}>
                <label htmlFor="su">Username</label>
                <input
                  id="su"
                  className="input"
                  value={standaloneUsername}
                  onChange={(e) => setStandaloneUsername(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="sp">Password</label>
                <input
                  id="sp"
                  className="input"
                  type="password"
                  value={standalonePassword}
                  onChange={(e) => setStandalonePassword(e.target.value)}
                />
              </div>
              <button className="btn btnPrimary" onClick={handleStandaloneLogin}>
                Log in
              </button>
            </div>
          </main>
        </>
      );
    }

    if (!isStandalonePaid) {
      return (
        <>
          <Head>
            <title>Mythos · LLM Chat (standalone)</title>
          </Head>
          <main className="shell llmShell">
            <div className="brandStrip">
              <span className="wordmark">LLM Chat</span>
              <span className="modeLabel">Standalone</span>
            </div>
            <div className="panel authPanel">
              <div className="eyebrow">Direct access</div>
              <div className="identity">
                <h1>Subscribe to continue</h1>
                <p>This app&apos;s own paywall, not Mythos — $9.99/mo, fake checkout for this demo.</p>
              </div>
              <button className="btn btnPrimary" onClick={() => setIsStandalonePaid(true)} style={{ marginTop: '1.25rem' }}>
                Subscribe
              </button>
            </div>
          </main>
        </>
      );
    }

    return (
      <>
        <Head>
          <title>Mythos · LLM Chat (standalone)</title>
        </Head>
        <main className="shell chatShell llmShell">
          <div className="brandStrip">
            <span className="wordmark">LLM Chat</span>
            <span className="modeLabel">Standalone</span>
          </div>
            <div className="panel panelFeatured workspacePanel chatWorkspace">
              <div className="panelTopline">
                <div className="eyebrow">Private inference workspace</div>
                <span className="statusPill"><span className="statusDot" /> Subscription active</span>
              </div>
              <div className="identity">
              <h1>Standalone LLM chat</h1>
              <p>Logged in via this app&apos;s own account — no Mythos credits used.</p>
            </div>
            <div className="chatBody">{renderChatPanel()}</div>
          </div>
        </main>
      </>
    );
  }

  if (sessionError) {
    return (
      <main className="shell llmShell">
        <p className="errorText">Session error: {sessionError}</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="shell llmShell">
        <p className="helperText">Verifying session…</p>
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>Mythos · LLM Chat</title>
      </Head>
      <main className="shell chatShell llmShell">
        <div className="brandStrip">
          <span className="wordmark">Mythos</span>
          <span className="modeLabel">LLM Chat</span>
        </div>

        <div className="panel panelFeatured workspacePanel chatWorkspace">
          <div className="panelTopline">
            <div className="eyebrow">Mythos gateway</div>
            <span className="statusPill"><span className="statusDot" /> Metered live</span>
          </div>
          <div className="identity">
            <h1>Welcome, {session.displayName}</h1>
            <p>{session.email}</p>
          </div>

          <div className="readout">
            <div className="readoutLabel">Credits charged this session</div>
            <div key={creditsChargedTotal} className="readoutValue flash">{creditsChargedTotal}</div>
          </div>

          <div className="chatBody">{renderChatPanel()}</div>
        </div>

        <a className="navLink" href={lt ? `/calculator?lt=${encodeURIComponent(lt)}` : '/calculator'}>
          Open Calculator
        </a>
      </main>
    </>
  );
}
