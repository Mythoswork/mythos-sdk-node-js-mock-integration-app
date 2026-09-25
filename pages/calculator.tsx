import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useMythos } from '@mythos-work/sdk/react';
import { CREDITS_PER_CALCULATION } from '@/lib/pricing';

type Operation = 'add' | 'subtract' | 'multiply' | 'divide';

const OPERATION_SYMBOL: Record<Operation, string> = {
  add: '+',
  subtract: '−',
  multiply: '×',
  divide: '÷',
};

// Fake standalone SaaS credentials — this is a demo gate only, not real auth.
const STANDALONE_USERNAME = 'demo';
const STANDALONE_PASSWORD = 'demo';

export default function Calculator() {
  const { status, session, error, fetch: mythosFetch, confirmCharge, relaunch } = useMythos();

  // Standalone (non-Mythos) gate state.
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

  async function handleCalculate() {
    if (!session) return;
    setCalcError(null);
    setIsSubmitting(true);

    try {
      setPendingLabel('Waiting for confirmation…');
      const { approved } = await confirmCharge({ credits: CREDITS_PER_CALCULATION, reason: `${operation}(${a}, ${b})` });
      if (!approved) {
        setCalcError(
          'Charge declined, timed out, or the dashboard is not listening — check the console for details.',
        );
        return;
      }

      setPendingLabel('Calculating…');
      const res = await mythosFetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, a, b }),
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

  function renderKeypad(onSubmit: () => void, submitLabel: string, disabled?: boolean) {
    return (
      <div className="calcRow">
        <input
          className="input"
          type="number"
          value={a}
          onChange={(e) => setA(Number(e.target.value))}
          disabled={disabled}
        />
        <select
          className="input"
          value={operation}
          onChange={(e) => setOperation(e.target.value as Operation)}
          disabled={disabled}
        >
          {(Object.keys(OPERATION_SYMBOL) as Operation[]).map((op) => (
            <option key={op} value={op}>
              {OPERATION_SYMBOL[op]}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="number"
          value={b}
          onChange={(e) => setB(Number(e.target.value))}
          disabled={disabled}
        />
        <button className="btn btnPrimary" onClick={onSubmit} disabled={disabled}>
          {submitLabel}
        </button>
      </div>
    );
  }

  if (status === 'standalone') {
    if (!isStandaloneLoggedIn) {
      return (
        <>
          <Head>
            <title>Mythos · Calculator (standalone)</title>
          </Head>
          <main className="shell">
            <div className="brandStrip">
              <span className="wordmark">Calculator</span>
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
            <title>Mythos · Calculator (standalone)</title>
          </Head>
          <main className="shell">
            <div className="brandStrip">
              <span className="wordmark">Calculator</span>
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
          <title>Mythos · Calculator (standalone)</title>
        </Head>
        <main className="shell">
          <div className="brandStrip">
            <span className="wordmark">Calculator</span>
            <span className="modeLabel">Standalone</span>
          </div>
          <div className="panel panelFeatured workspacePanel">
            <div className="panelTopline">
              <div className="eyebrow">Interactive listing</div>
              <span className="statusPill"><span className="statusDot" /> Live session</span>
            </div>
            <div className="identity">
              <h1>Standalone calculator</h1>
              <p>Logged in via this app&apos;s own account — no Mythos credits used.</p>
            </div>
            <div style={{ marginTop: '1.5rem' }}>{renderKeypad(standaloneCalculate, '=')}</div>
            {result !== null && (
              <p className="calcResult">
                Result: <strong>{result}</strong>
              </p>
            )}
          </div>
        </main>
      </>
    );
  }

  if (status === 'expired') {
    return <main className="shell"><p className="errorText">Session expired.</p><button className="btn btnPrimary" onClick={relaunch}>Relaunch from Mythos</button></main>;
  }

  if (status === 'error') {
    return (
      <main className="shell">
        <p className="errorText">Session error: {error?.message}</p>
      </main>
    );
  }

  if (status === 'loading' || !session) {
    return (
      <main className="shell">
        <p className="helperText">Verifying session…</p>
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>Mythos · Calculator</title>
      </Head>
      <main className="shell">
        <div className="brandStrip">
          <span className="wordmark">Mythos</span>
          <span className="modeLabel">Calculator</span>
        </div>

        <div className="panel">
          <div className="identity">
            <h1>Welcome, {session.displayName}</h1>
            <p>{session.email}</p>
          </div>

          <div className="readout">
            <div className="readoutLabel">Credits charged this session</div>
            <div key={creditsChargedTotal} className="readoutValue flash">{creditsChargedTotal}</div>
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            {renderKeypad(handleCalculate, pendingLabel ?? '=', isSubmitting)}
          </div>

          {result !== null && (
            <p className="calcResult">
              Result: <strong>{result}</strong>
            </p>
          )}
          {calcError && <p className="errorText">{calcError}</p>}
        </div>

        <Link className="navLink" href="/llm">
          Open LLM Chat
        </Link>
      </main>
    </>
  );
}
