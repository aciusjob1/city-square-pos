import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, homePathForRole } from '../auth/AuthContext';
import './LoginPage.css';

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    const res = await login(username.trim(), password);
    setBusy(false);
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
        </header>

        {error && (
          <div className="login-error error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="staff-form" autoComplete="on">
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
            disabled={busy || !username.trim() || !password}
          >
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <footer className="login-footer">
          <span className="status">
            <span className="status-dot" />
            Online
          </span>
          <span>Staff Access</span>
        </footer>
      </section>
    </main>
  );
}
