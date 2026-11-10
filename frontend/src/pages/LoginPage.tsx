import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, homePathForRole } from '../auth/AuthContext';
import './LoginPage.css';

type LoginMode = 'waiter' | 'staff';

export function LoginPage() {
  const { user, login, loginPin } = useAuth();
  const [mode, setMode] = useState<LoginMode>('waiter');
  const [pin, setPin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  if (user) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  // ---------- PIN ----------

  const addDigit = (digit: string) => {
    if (pin.length < 4 && !loading) {
      setError(null);
      const next = pin + digit;
      setPin(next);
      if (next.length === 4) {
        submitWaiter(next);
      }
    }
  };

  const clearPin = () => setPin('');
  const removeDigit = () => setPin((p) => p.slice(0, -1));

  const switchMode = (next: LoginMode) => {
    setMode(next);
    setPin('');
    setError(null);
  };

  const submitWaiter = async (value: string) => {
    if (value.length !== 4 || loading) return;
    setLoading(true);
    setError(null);
    const res = await loginPin(value);
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? 'Incorrect PIN');
      setShake(true);
      window.setTimeout(() => setShake(false), 400);
      setPin('');
    }
  };

  const onWaiterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await submitWaiter(pin);
  };

  // ---------- Staff ----------

  const onStaffSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || loading) return;
    setLoading(true);
    setError(null);
    const res = await login(username.trim(), password);
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? 'Login failed');
    }
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <header className="login-header">
          <div className="brand-icon">CS</div>
          <h1>City Square</h1>
          <p>Restaurant Management System</p>
          <span className="welcome-text">Welcome back. Please sign in.</span>
        </header>

        <div className="login-tabs">
          <button
            type="button"
            className={mode === 'waiter' ? 'active' : ''}
            onClick={() => switchMode('waiter')}
            disabled={loading}
          >
            Waiter PIN
          </button>
          <button
            type="button"
            className={mode === 'staff' ? 'active' : ''}
            onClick={() => switchMode('staff')}
            disabled={loading}
          >
            Staff Password
          </button>
        </div>

        {error && (
          <div className="login-error error" role="alert">
            {error}
          </div>
        )}

        {mode === 'waiter' ? (
          <form onSubmit={onWaiterSubmit}>
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

            <div className="keypad pin-keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => addDigit(d)}
                  disabled={loading || pin.length >= 4}
                >
                  {d}
                </button>
              ))}

              <button
                type="button"
                className="key-secondary"
                onClick={clearPin}
                disabled={loading}
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() => addDigit('0')}
                disabled={loading || pin.length >= 4}
              >
                0
              </button>

              <button
                type="button"
                className="key-secondary"
                onClick={removeDigit}
                disabled={loading || !pin.length}
                aria-label="Delete last digit"
              >
                ⌫
              </button>
            </div>

            <button
              type="submit"
              className="login-submit"
              disabled={pin.length !== 4 || loading}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={onStaffSubmit} className="staff-form">
            <h2>Staff Login</h2>
            <p>Sign in using your staff account.</p>

            <label htmlFor="staff-username">Username</label>
            <input
              id="staff-username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />

            <label htmlFor="staff-password">Password</label>
            <div className="password-field">
              <input
                id="staff-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            <button
              type="submit"
              className="login-submit"
              disabled={loading || !username.trim() || !password}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        <footer className="login-footer">
          <span className="status">
            <span className="status-dot" />
            Online
          </span>
          <span>Secure Staff Access</span>
        </footer>
      </section>
    </main>
  );
}
