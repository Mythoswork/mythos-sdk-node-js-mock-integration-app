import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
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

      setMessages((prev) => [...prev, { role: 'user', content: message }]);
      setInput('');

      // Always the same endpoint -- /api/chat decides Mythos-billed vs. standalone by
      // whether the session cookie is present, the same way /api/calculate always just
      // takes `lt`. The client never needs to know or choose which mode it's in.
      const res = await fetch('/api/chat', {
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
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: 4,
            minHeight: 240,
            maxHeight: 480,
            overflowY: 'auto',
            padding: '0.75rem',
          }}
        >
          {messages.length === 0 ? (
            <p style={{ color: '#666' }}>No messages yet.</p>
          ) : (
            messages.map((message, index) => (
              <p key={`${message.role}-${index}`}>
                <strong>{message.role === 'user' ? 'You' : 'Assistant'}:</strong> {message.content}
              </p>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask something..."
            disabled={isSubmitting}
            style={{ flex: 1 }}
          />
          <button onClick={() => void handleSend()} disabled={isSubmitting || !input.trim()}>
            {isSubmitting ? 'Sending...' : 'Send'}
          </button>
        </div>

        {chatError && <p style={{ color: 'red' }}>{chatError}</p>}
        {lastCost && (
          <p>
            Cost: {lastCost.credits ?? '?'} credit{lastCost.credits === 1 ? '' : 's'}
            {lastCost.microunits ? ` (${lastCost.microunits} microunits` : ''}
            {lastCost.source ? `, ${lastCost.source}` : ''}
            {lastCost.microunits ? ')' : ''}
            {lastCost.status ? ` - ${lastCost.status}` : ''}
          </p>
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
        <main style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '2rem auto', padding: '0 1rem' }}>
          <h1>Standalone LLM Chat</h1>
          <p>No Mythos session detected. Log in with this app&apos;s own account.</p>
          {standaloneLoginError && <p style={{ color: 'red' }}>{standaloneLoginError}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 240 }}>
            <input
              placeholder="username"
              value={standaloneUsername}
              onChange={(e) => setStandaloneUsername(e.target.value)}
            />
            <input
              placeholder="password"
              type="password"
              value={standalonePassword}
              onChange={(e) => setStandalonePassword(e.target.value)}
            />
            <button onClick={handleStandaloneLogin}>Log in</button>
          </div>
        </main>
      );
    }

    if (!isStandalonePaid) {
      return (
        <main style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '2rem auto', padding: '0 1rem' }}>
          <h1>Subscribe to use LLM Chat</h1>
          <p>This app&apos;s own paywall — not Mythos. $9.99/mo, fake checkout for this demo.</p>
          <button onClick={() => setIsStandalonePaid(true)}>Subscribe</button>
        </main>
      );
    }

    return (
      <main style={{ fontFamily: 'sans-serif', maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Standalone LLM Chat</h1>
        <p>Logged in via this app&apos;s own account. No Mythos credits used — this operation never calls Mythos.</p>
        {renderChatPanel()}
      </main>
    );
  }

  if (sessionError) {
    return (
      <main style={{ fontFamily: 'sans-serif', padding: '2rem', color: 'red' }}>
        Session error: {sessionError}
      </main>
    );
  }

  if (!session) {
    return <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>Verifying session...</main>;
  }

  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Mythos LLM Chat</h1>
      <p>
        Welcome, {session.displayName} ({session.email})
      </p>
      <p>Credits charged this session: {creditsChargedTotal}</p>
      <p>
        <a href={lt ? `/calculator?lt=${encodeURIComponent(lt)}` : '/calculator'}>← Calculator</a>
      </p>
      {renderChatPanel()}
    </main>
  );
}
