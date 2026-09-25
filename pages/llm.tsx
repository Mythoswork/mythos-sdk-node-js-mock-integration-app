import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useMythos } from '@mythos-work/sdk/react';
import { estimateChatCredits } from '@/lib/pricing';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Fake standalone SaaS credentials — this is a demo gate only, not real auth.
const STANDALONE_USERNAME = 'demo';
const STANDALONE_PASSWORD = 'demo';

export default function LlmPage() {
  const { status, session, error, fetch: mythosFetch, confirmCharge, relaunch } = useMythos();

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
        const { approved } = await confirmCharge({ credits: estimateChatCredits(message), reason: `chat: "${message.slice(0, 40)}"`, kind: 'llm' });
        if (!approved) {
          setChatError(
            'Charge declined, timed out, or the dashboard is not listening — check the console for details.',
          );
          return;
        }
      }

      setMessages((prev) => [...prev, { role: 'user', content: message }]);
      setInput('');

      // Always the same endpoint -- /api/chat decides Mythos-billed vs. standalone by
      // whether the request carries a Mythos session. The client does not choose a mode.
      const res = await mythosFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const body = await res.json();
      if (!body.success) {
        setChatError(body.error);
        return;
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: body.data.reply ?? '' }]);
      if (typeof body.data.creditsCharged === 'number') {
        setCreditsChargedTotal((prev) => prev + body.data.creditsCharged);
        setLastCost({
          credits: body.data.creditsCharged,
          microunits: body.data.mythosCostMicrounits ?? null,
          source: body.data.mythosPricingSource ?? null,
          status: body.data.billingStatus ?? null,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function renderChatPanel() {
    return (
      <>
        <div className="chatLog">
          {messages.length === 0 ? (
            <p className="chatEmpty">No messages yet.</p>
          ) : (
            messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`chatBubble ${message.role === 'user' ? 'chatBubbleUser' : 'chatBubbleAssistant'}`}
              >
                {message.content}
              </div>
            ))
          )}
        </div>

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

  if (status === 'standalone') {
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

  if (status === 'expired') {
    return <main className="shell llmShell"><p className="errorText">Session expired.</p><button className="btn btnPrimary" onClick={relaunch}>Relaunch from Mythos</button></main>;
  }

  if (status === 'error') {
    return (
      <main className="shell llmShell">
        <p className="errorText">Session error: {error?.message}</p>
      </main>
    );
  }

  if (status === 'loading' || !session) {
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

        <Link className="navLink" href="/calculator">
          Open Calculator
        </Link>
      </main>
    </>
  );
}
