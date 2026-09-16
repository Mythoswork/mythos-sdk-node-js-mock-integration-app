import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { confirmCharge } from '@/lib/confirm-charge';
import { CREDITS_PER_CALCULATION } from '@/lib/pricing';

interface MythosSession {
  userId: string;
  email: string;
  displayName: string;
  listingId: string;
  sessionJti: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type Operation = 'add' | 'subtract' | 'multiply' | 'divide';

// Fake standalone SaaS credentials — this is a demo gate only, not real auth.
const STANDALONE_USERNAME = 'demo';
const STANDALONE_PASSWORD = 'demo';

export default function Calculator() {
  const router = useRouter();
  const lt = typeof router.query.lt === 'string' ? router.query.lt : undefined;

  const verifyStarted = useRef(false);
  const [session, setSession] = useState<MythosSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Standalone (non-Mythos) gate state — only relevant when there's no `lt` at all.
  const [standaloneUsername, setStandaloneUsername] = useState('');
  const [standalonePassword, setStandalonePassword] = useState('');
  const [standaloneLoginError, setStandaloneLoginError] = useState<string | null>(null);
  const [isStandaloneLoggedIn, setIsStandaloneLoggedIn] = useState(false);
  const [isStandalonePaid, setIsStandalonePaid] = useState(false);

  const [a, setA] = useState(1);
  const [b, setB] = useState(1);
  const [operation, setOperation] = useState<Operation>('add');
  const [result, setResult] = useState<number | null>(null);
  const [creditsChargedTotal, setCreditsChargedTotal] = useState(0);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatCreditsTotal, setChatCreditsTotal] = useState(0);
  const [lastMythosCost, setLastMythosCost] = useState<{
    microunits: string | null;
    source: string | null;
  } | null>(null);
  const [isChatSubmitting, setIsChatSubmitting] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  useEffect(() => {
    if (!lt || verifyStarted.current) return;
    verifyStarted.current = true;

    fetch(`/api/verify-session?lt=${encodeURIComponent(lt)}`)
      .then((res) => res.json())
      .then((body) => {
        if (body.success) {
          setSession(body.data);
          window.parent.postMessage({ type: 'mythos:handshake' }, '*');
        } else {
          setSessionError(body.error ?? 'Session verification failed');
        }
      })
      .catch((err) => setSessionError(String(err)));
  }, [lt]);

  async function handleCalculate() {
    if (!lt) return;
    setCalcError(null);
    setIsSubmitting(true);

    try {
      setPendingLabel('Waiting for confirmation…');
      const approved = await confirmCharge(CREDITS_PER_CALCULATION, `${operation}(${a}, ${b})`);
      if (!approved) {
        setCalcError(
          'Charge declined, timed out, or the dashboard is not listening — check the console for details.',
        );
        return;
      }

      setPendingLabel('Calculating…');
      const res = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lt, operation, a, b }),
      });
      const body = await res.json();
      if (!body.success) {
        setCalcError(body.error);
        return;
      }
      setResult(body.data.result);
      setCreditsChargedTotal((prev) => prev + body.data.creditsCharged);
    } finally {
      setIsSubmitting(false);
      setPendingLabel(null);
    }
  }

  async function handleSendChatMessage() {
    const message = chatInput.trim();
    if (!lt || !session || !message || isChatSubmitting) return;

    setChatError(null);
    setIsChatSubmitting(true);
    try {
      setChatMessages((previous) => [...previous, { role: 'user', content: message }]);
      setChatInput('');
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lt, message }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        setChatError(body.error ?? 'Chat request failed');
        return;
      }

      setChatMessages((previous) => [...previous, { role: 'assistant', content: body.data.reply ?? '' }]);
       if (typeof body.data.creditsCharged === 'number') {
         setChatCreditsTotal((previous) => previous + body.data.creditsCharged);
       }
      setLastMythosCost({
        microunits: body.data.mythosCostMicrounits ?? null,
        source: body.data.mythosPricingSource ?? null,
      });
    } catch {
      setChatError('Chat request failed.');
    } finally {
      setIsChatSubmitting(false);
    }
  }

  function handleStandaloneLogin() {
    setStandaloneLoginError(null);
    if (standaloneUsername === STANDALONE_USERNAME && standalonePassword === STANDALONE_PASSWORD) {
      setIsStandaloneLoggedIn(true);
    } else {
      setStandaloneLoginError('Invalid username or password.');
    }
  }

  function standaloneCalculate() {
    let value: number;
    switch (operation) {
      case 'add':
        value = a + b;
        break;
      case 'subtract':
        value = a - b;
        break;
      case 'multiply':
        value = a * b;
        break;
      case 'divide':
        value = a / b;
        break;
    }
    setResult(value);
  }

  // No `lt` at all: this is direct/independent access, not via Mythos.
  // The SDK never runs here, so this app's own auth + paywall gate the feature —
  // there is nothing for Mythos to bypass, because Mythos was never involved.
  if (!lt) {
    if (!isStandaloneLoggedIn) {
      return (
        <main style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '2rem auto', padding: '0 1rem' }}>
          <h1>Standalone Calculator</h1>
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
          <h1>Subscribe to use the calculator</h1>
          <p>This app&apos;s own paywall — not Mythos. $9.99/mo, fake checkout for this demo.</p>
          <button onClick={() => setIsStandalonePaid(true)}>Subscribe</button>
        </main>
      );
    }

    return (
      <main style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Standalone Calculator</h1>
        <p>Logged in via this app&apos;s own account. No Mythos credits used — this operation never calls Mythos.</p>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
          <input type="number" value={a} onChange={(e) => setA(Number(e.target.value))} />
          <select value={operation} onChange={(e) => setOperation(e.target.value as Operation)}>
            <option value="add">+</option>
            <option value="subtract">-</option>
            <option value="multiply">*</option>
            <option value="divide">/</option>
          </select>
          <input type="number" value={b} onChange={(e) => setB(Number(e.target.value))} />
          <button onClick={standaloneCalculate}>=</button>
        </div>

        {result !== null && <p>Result: {result}</p>}
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
    <main style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Mythos Calculator</h1>
      <p>
        Welcome, {session.displayName} ({session.email})
      </p>
      <p>Credits charged this session: {creditsChargedTotal}</p>

      {calcError && <p style={{ color: 'red' }}>{calcError}</p>}

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
        <input type="number" value={a} onChange={(e) => setA(Number(e.target.value))} disabled={isSubmitting} />
        <select
          value={operation}
          onChange={(e) => setOperation(e.target.value as Operation)}
          disabled={isSubmitting}
        >
          <option value="add">+</option>
          <option value="subtract">-</option>
          <option value="multiply">*</option>
          <option value="divide">/</option>
        </select>
        <input type="number" value={b} onChange={(e) => setB(Number(e.target.value))} disabled={isSubmitting} />
        <button onClick={handleCalculate} disabled={isSubmitting}>
          {pendingLabel ?? '='}
        </button>
      </div>

      {result !== null && <p>Result: {result}</p>}

      <section style={{ marginTop: '2rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
        <h2>LLM Chat</h2>
         <p>Charged from observed provider cost, creator margin, and the Mythos platform fee.</p>
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: 4,
            minHeight: 120,
            maxHeight: 240,
            overflowY: 'auto',
            padding: '0.75rem',
          }}
        >
          {chatMessages.length === 0 ? (
            <p style={{ color: '#666' }}>No messages yet.</p>
          ) : (
            chatMessages.map((chatMessage, index) => (
              <p key={`${chatMessage.role}-${index}`}>
                <strong>{chatMessage.role === 'user' ? 'You' : 'Assistant'}:</strong> {chatMessage.content}
              </p>
            ))
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSendChatMessage();
          }}
          style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}
        >
          <input
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
             placeholder="Ask something..."
             disabled={isChatSubmitting}
            style={{ flex: 1 }}
          />
           <button type="submit" disabled={isChatSubmitting || !chatInput.trim()}>
            {isChatSubmitting ? 'Sending...' : 'Send'}
          </button>
        </form>

        {chatError && <p style={{ color: 'red' }}>{chatError}</p>}
        <p>Chat credits charged: {chatCreditsTotal}</p>
        {lastMythosCost && (
          <p>
            Real Mythos cost: {lastMythosCost.microunits ?? 'unavailable'} microunits
            {lastMythosCost.source ? ` (${lastMythosCost.source})` : ''}
          </p>
        )}
      </section>
    </main>
  );
}
