import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, homePathForRole } from '../auth/AuthContext';
import './LoginPage.css';

export function WaiterLoginPage() {
  const { user, loginPin } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  if (user) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  const addDigit = (digit: string) => {
    if (busy || pin.length >= 4) return;
    setError(null);
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) {
      submitPin(next);
    }
  };

  const removeDigit = () => {
    if (busy || pin.length === 0) return;
    setError(null);
    setPin(pin.slice(0, -1));
  };

  const clearPin = () => {
    if (busy) return;
    setPin('');
    setError(null);
  };

  const submitPin = async (value: string) => {
    if (value.length !== 4 || busy) return;
    setBusy(true);
    setError(null);
    const res = await loginPin(value);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Incorrect PIN');
      setShake(true);
      window.setTimeout(() => setShake(false), 400);
      setPin('');
    }
  };

  const keys: Array<{ label: string; onClick: () => void; className?: string }> = [
    { label: '1', onClick: () => addDigit('1') },
    { label: '2', onClick: () => addDigit('2') },
    { label: '3', onClick: () => addDigit('3') },
    { label: '4', onClick: () => addDigit('4') },
    { label: '5', onClick: () => addDigit('5') },
    { label: '6', onClick: () => addDigit('6') },
    { label: '7', onClick: () => addDigit('7') },
    { label: '8', onClick: () => addDigit('8') },
    { label: '9', onClick: () => addDigit('9') },
    { label: 'Clear', onClick: clearPin, className: 'key-secondary' },
    { label: '0', onClick: () => addDigit('0') },
    { label: '⌫', onClick: removeDigit, className: 'key-secondary' },
  ];

  return (
    <main className="login-page">
      <section className="login-card">
        <header className="login-header">
          <div className="brand-icon">CS</div>
          <h1>City Square</h1>
          <p>Waiter Terminal</p>
        </header>

        <div className="pin-section">
          <h2>Enter your PIN</h2>
          <p>Enter your 4-digit waiter PIN</p>

          <div
            className={`pin-indicators${shake ? ' shake' : ''}`}
            aria-label={`${pin.length} of 4 PIN digits entered`}
          >
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={i < pin.length ? 'filled' : ''} />
            ))}
          </div>
        </div>

        {error && (
          <div className="login-error error" role="alert">
            {error}
          </div>
        )}

        <div className="keypad pin-keypad">
          {keys.map((k) => (
            <button
              key={k.label}
              type="button"
              className={k.className ?? ''}
              onClick={k.onClick}
              disabled={busy || (k.label !== 'Clear' && k.label !== '⌫' && pin.length >= 4)}
              aria-label={k.label === '⌫' ? 'Delete last digit' : undefined}
            >
              {k.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="login-submit"
          disabled={pin.length !== 4 || busy}
          onClick={() => submitPin(pin)}
        >
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        <footer className="login-footer">
          <span className="status">
            <span className="status-dot" />
            Online
          </span>
          <span>Waiter Access</span>
        </footer>
      </section>
    </main>
  );
}
