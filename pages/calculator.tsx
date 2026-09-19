import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { confirmCharge, sendHandshake } from '@mythos-work/sdk/client';
import { CREDITS_PER_CALCULATION } from '@/lib/pricing';

interface MythosSession {
  userId: string;
  email: string;
  displayName: string;
  listingId: string;
  sessionJti: string;
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

  useEffect(() => {
    // router.isReady guards against Next's Pages Router not having parsed the query
    // string yet on first render -- without this, the very first verify attempt can fire
    // with `lt` still undefined even though it's right there in the URL, and since
    // verifyStarted latches immediately, that bad attempt is never retried.
    if (!router.isReady || verifyStarted.current) return;
    verifyStarted.current = true;

    // No `lt` is fine here -- the session cookie from an earlier page (e.g. /llm) already
    // covers it; /api/verify-session checks that cookie before ever needing `lt`.
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

  async function handleCalculate() {
    if (!lt) {
      setCalcError('Missing launch token in the URL -- reopen this app from Mythos to calculate.');
      return;
    }
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

  // Standalone (no Mythos at all): only once verify-session has actually been tried and
  // found nothing -- no `lt`, and no session cookie from another page either. The SDK
  // never runs here, so this app's own auth + paywall gate the feature; there is nothing
  // for Mythos to bypass, because Mythos was never involved.
  if (!lt && !session && sessionError) {
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
      <p>
        <a href={lt ? `/llm?lt=${encodeURIComponent(lt)}` : '/llm'}>Try LLM Chat →</a>
      </p>

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
    </main>
  );
}
