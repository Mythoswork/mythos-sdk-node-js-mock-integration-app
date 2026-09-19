import { useState } from 'react';
import Head from 'next/head';

interface WalletSummary {
  subscription: number;
  topup: number;
  total: number;
}

interface LaunchResult {
  launch_url: string;
  launch_token: string;
  expires_at: string;
}

interface LaunchHistoryItem {
  listing_id: string;
  title: string;
  launch_count: number;
  last_launched_at: string;
  total_metered_credits_charged: number;
}

export default function Harness() {
  const [email, setEmail] = useState('carol@example.com');
  const [password, setPassword] = useState('Test@1234');
  const [token, setToken] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);
  const [history, setHistory] = useState<LaunchHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refreshWallet(bearerToken: string) {
    const res = await fetch('/api/harness/wallet', {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    const body = await res.json();
    if (body.success) setWallet(body.data);
  }

  async function refreshHistory(bearerToken: string) {
    const res = await fetch('/api/harness/launch-history', {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    const body = await res.json();
    if (body.success) setHistory(body.data.data);
  }

  async function handleLogin() {
    setError(null);
    const res = await fetch('/api/harness/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!body.success) {
      setError(body.error);
      return;
    }
    setToken(body.data.token);
    await refreshWallet(body.data.token);
    await refreshHistory(body.data.token);
  }

  async function handleLaunch() {
    if (!token) return;
    setError(null);
    const res = await fetch('/api/harness/launch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!body.success) {
      setError(body.error);
      return;
    }
    setLaunchResult(body.data);
    await refreshWallet(token);
    await refreshHistory(token);
  }

  return (
    <>
      <Head>
        <title>Mythos · Harness</title>
      </Head>
      <main className="shell shellLanding">
        <div className="brandStrip">
          <span className="wordmark">Mythos</span>
          <div className="brandAside">
            <span className="statusPill"><span className="statusDot" /> Local preview</span>
            <span className="modeLabel">Producer console</span>
          </div>
        </div>

        <section className="heroBand">
          <div>
            <div className="eyebrow">Mythos / integration preview</div>
            <h1 className="heroTitle">Make a listing feel <span>alive.</span></h1>
            <p className="heroCopy">
              A polished producer console for launching experiences, watching wallet movement, and proving the
              full marketplace loop in one place.
            </p>
          </div>
          <div className="heroMeta">
            <span className="metaChip">ES256 sessions</span>
            <span className="metaChip">Usage metering</span>
          </div>
        </section>

        {error && <p className="errorText">{error}</p>}

        <div className="panel panelFeatured">
          <div className="panelTopline">
            <div>
              <div className="eyebrow">Launch flow</div>
              <h2 className="panelHeading">Open a real consumer session</h2>
            </div>
            <span className="metaChip">2 steps</span>
          </div>
          <div className="stepRail">
            <div className="step">
              <div className={`stepMarker ${token ? 'stepDone' : ''}`}>{token ? '✓' : '1'}</div>
              <div className="stepBody">
                <div className="stepTitle">Log in</div>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <button className="btn btnPrimary" onClick={handleLogin} disabled={!!token}>
                  {token ? 'Logged in' : 'Log in'}
                </button>
              </div>
            </div>

            <div className="step">
              <div className={`stepMarker ${launchResult ? 'stepDone' : ''}`}>{launchResult ? '✓' : '2'}</div>
              <div className="stepBody">
                <div className="stepTitle">Launch the Calculator listing</div>
                <button className="btn btnPrimary" onClick={handleLaunch} disabled={!token}>
                  Launch
                </button>
                {launchResult && (
                  <p className="helperText" style={{ marginTop: '0.75rem' }}>
                    <a className="navLink" href={`/calculator?lt=${encodeURIComponent(launchResult.launch_token)}`} target="_blank" rel="noreferrer" style={{ marginTop: 0 }}>
                      Open Calculator
                    </a>
                    <br />
                    expires {launchResult.expires_at}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {wallet && (
          <div className="panel metricsPanel">
            <div className="eyebrow">Wallet snapshot</div>
            <div className="readoutLabel">Wallet balance</div>
            <div className="readoutValue">{wallet.total}</div>
            <div className="walletRow" style={{ marginTop: '1rem' }}>
              <span className="ledgerLabel">Subscription credits</span>
              <span className="ledgerValue">{wallet.subscription}</span>
            </div>
            <div className="walletRow">
              <span className="ledgerLabel">Top-up credits</span>
              <span className="ledgerValue">{wallet.topup}</span>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div className="panel historyPanel">
            <div className="eyebrow">Recent activity</div>
            <div className="panelHeading">Launch history</div>
            {history.map((item) => (
              <div className="walletRow" key={item.listing_id}>
                <span className="ledgerLabel">
                  {item.title} · {item.launch_count} launch{item.launch_count === 1 ? '' : 'es'}
                </span>
                <span className="ledgerValue">{item.total_metered_credits_charged} credits</span>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
