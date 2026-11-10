import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  listUsersFull,
  listRolesFull,
  createUser,
  updateUser,
  resetUserPassword,
  setUserPin,
  deactivateUser,
} from '../../lib/manager.api';
import type { UserRow } from '../../lib/manager.api';
import './ManagerUsers.css';

type EditState =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; id: string }
  | { kind: 'password'; id: string }
  | { kind: 'pin'; id: string };

export function ManagerUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({ kind: 'none' });
  const [saving, setSaving] = useState(false);

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('WAITER');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');

  const isAdmin = me?.role === 'ADMIN';

  const allowedRoles = isAdmin
    ? roles
    : roles.filter((r) => r !== 'ADMIN' && r !== 'MANAGER');

  async function load() {
    const [usersRes, rolesRes] = await Promise.all([listUsersFull(), listRolesFull()]);
    if (!usersRes.ok || !usersRes.data) {
      setError(usersRes.errorMessage ?? 'Failed to load users');
      return;
    }
    if (rolesRes.ok && rolesRes.data) setRoles(rolesRes.data.roles);
    setError(null);
    setUsers(usersRes.data.users);
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setEdit({ kind: 'none' });
    setUsername(''); setFullName(''); setEmail('');
    setPassword(''); setPin('');
  }

  function beginAdd() {
    setEdit({ kind: 'add' });
    setUsername(''); setFullName(''); setEmail('');
    setPassword(''); setPin('');
    setRole('WAITER');
  }

  function beginEdit(u: UserRow) {
    setEdit({ kind: 'edit', id: u.id });
    setUsername(u.username);
    setFullName(u.fullName);
    setEmail(u.email ?? '');
    setRole(u.role);
  }

  function beginPassword(u: UserRow) {
    setEdit({ kind: 'password', id: u.id });
    setUsername(u.username);
    setPassword('');
  }

  function beginPin(u: UserRow) {
    setEdit({ kind: 'pin', id: u.id });
    setUsername(u.username);
    setPin('');
  }

  async function submitAdd() {
    setSaving(true);
    setError(null);
    const payload: any = {
      username: username.trim(),
      fullName: fullName.trim(),
      email: email.trim() || undefined,
      role,
      password,
    };
    if (pin.trim()) payload.pin = pin.trim();
    const res = await createUser(payload);
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Create failed'); return; }
    setToast('User created');
    setTimeout(() => setToast(null), 2000);
    resetForm();
    await load();
  }

  async function submitEdit() {
    if (edit.kind !== 'edit') return;
    setSaving(true);
    setError(null);
    const res = await updateUser(edit.id, {
      fullName: fullName.trim(),
      email: email.trim() || undefined,
      role,
    });
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Update failed'); return; }
    setToast('User updated');
    setTimeout(() => setToast(null), 2000);
    resetForm();
    await load();
  }

  async function submitPassword() {
    if (edit.kind !== 'password') return;
    setSaving(true);
    setError(null);
    const res = await resetUserPassword(edit.id, password);
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'Reset failed'); return; }
    setToast('Password reset');
    setTimeout(() => setToast(null), 2000);
    resetForm();
  }

  async function submitPin() {
    if (edit.kind !== 'pin') return;
    setSaving(true);
    setError(null);
    const res = await setUserPin(edit.id, pin);
    setSaving(false);
    if (!res.ok) { setError(res.errorMessage ?? 'PIN set failed'); return; }
    setToast('PIN updated');
    setTimeout(() => setToast(null), 2000);
    resetForm();
    await load();
  }

  async function handleDeactivate(u: UserRow) {
    if (!confirm(`Deactivate "${u.username}"?`)) return;
    const res = await deactivateUser(u.id);
    if (!res.ok) { setError(res.errorMessage ?? 'Deactivate failed'); return; }
    setToast('User deactivated');
    setTimeout(() => setToast(null), 2000);
    await load();
  }

  function canActOn(target: UserRow): boolean {
    if (me?.role === 'ADMIN') return target.id !== me.id;
    return target.role !== 'ADMIN' && target.role !== 'MANAGER';
  }

  return (
    <div className="page manager-page">
      <div className="manager-users-header">
        <h2>Users</h2>
        {edit.kind === 'none' && (
          <button className="manager-refresh" onClick={beginAdd}>
            + Add User
          </button>
        )}
      </div>

      {edit.kind === 'add' && (
        <div className="manager-user-form">
          <label>Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={50} autoFocus />
          </label>
          <label>Full name
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={100} />
          </label>
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} placeholder="optional" />
          </label>
          <label>Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {allowedRoles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label>Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={100} />
          </label>
          {role === 'WAITER' && (
            <label>PIN (4 digits)
              <input value={pin} onChange={(e) => setPin(e.target.value)} maxLength={4} placeholder="optional" style={{ width: '80px' }} />
            </label>
          )}
          <div className="actions">
            <button className="primary" onClick={submitAdd} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={resetForm} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}

      {edit.kind === 'edit' && (
        <div className="manager-user-form">
          <label>Username
            <input value={username} disabled />
          </label>
          <label>Full name
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={100} autoFocus />
          </label>
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
          </label>
          <label>Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {allowedRoles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <div className="actions">
            <button className="primary" onClick={submitEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={resetForm} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}

      {edit.kind === 'password' && (
        <div className="manager-user-form">
          <label>Reset password for {username}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={100} autoFocus />
          </label>
          <div className="actions">
            <button className="primary" onClick={submitPassword} disabled={saving}>{saving ? 'Saving…' : 'Reset'}</button>
            <button onClick={resetForm} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}

      {edit.kind === 'pin' && (
        <div className="manager-user-form">
          <label>Set PIN for {username}
            <input value={pin} onChange={(e) => setPin(e.target.value)} maxLength={4} autoFocus style={{ width: '80px' }} />
          </label>
          <div className="actions">
            <button className="primary" onClick={submitPin} disabled={saving}>{saving ? 'Saving…' : 'Set PIN'}</button>
            <button onClick={resetForm} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      {!users && !error && <p className="muted">Loading…</p>}

      {users && users.length > 0 && (
        <div className="manager-table-scroll">
          <section className="manager-section">
            <table className="manager-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Full name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th style={{ width: '260px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const editable = canActOn(u);
                  return (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>{u.fullName}</td>
                      <td><span className="manager-user-role">{u.role}</span></td>
                      <td>
                        <span className={`manager-user-pill ${u.isActive ? 'active' : 'inactive'}`}>
                          {u.isActive ? '● Active' : '● Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="manager-row-actions">
                          {editable && <button onClick={() => beginEdit(u)}>Edit</button>}
                          {editable && <button onClick={() => beginPassword(u)}>Reset PW</button>}
                          {editable && u.role === 'WAITER' && <button onClick={() => beginPin(u)}>PIN</button>}
                          {editable && u.isActive && <button className="danger" onClick={() => handleDeactivate(u)}>Deactivate</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
