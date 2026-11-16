import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { changeMyPassword } from '../lib/auth.api';

interface Props {
  onClose: () => void;
}

export function ChangePasswordDialog({ onClose }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    currentRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from the current password.');
      return;
    }
    setSaving(true);
    setError(null);
    const res = await changeMyPassword(currentPassword, newPassword);
    setSaving(false);
    if (!res.ok) {
      setError(res.errorMessage ?? 'Could not change the password');
      return;
    }
    setDone(true);
  }

  return (
    <div className="password-modal-backdrop" onMouseDown={onClose}>
      <div
        className="password-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="password-modal-title">Change password</h3>

        {done ? (
          <>
            <p className="password-modal-success">Your password has been changed.</p>
            <div className="password-modal-actions">
              <button type="button" className="primary" onClick={onClose} autoFocus>
                Close
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>
              Current password
              <input
                ref={currentRef}
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                maxLength={100}
                autoComplete="current-password"
              />
            </label>
            <label>
              New password
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                maxLength={100}
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                maxLength={100}
                autoComplete="new-password"
              />
            </label>
            <p className="password-modal-hint">
              At least 8 characters, with a letter and a digit.
            </p>

            {error && <div className="error">{error}</div>}

            <div className="password-modal-actions">
              <button type="submit" className="primary" disabled={saving}>
                {saving ? 'Saving…' : 'Change password'}
              </button>
              <button type="button" onClick={onClose} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
