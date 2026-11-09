import { useAuth } from '../../auth/AuthContext';

export function ManagerHome() {
  const { user } = useAuth();
  return (
    <div className="page">
      <div className="placeholder card">
        <span className="role">{user?.role}</span>
        <h1>Manager</h1>
        <p className="muted">
          Signed in as {user?.fullName}. Reports and controls arrive in Phase 4b.
        </p>
      </div>
    </div>
  );
}
