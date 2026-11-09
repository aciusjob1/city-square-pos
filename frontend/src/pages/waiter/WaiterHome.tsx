import { useAuth } from '../../auth/AuthContext';

export function WaiterHome() {
  const { user } = useAuth();
  return (
    <div className="page">
      <div className="placeholder card">
        <span className="role">WAITER</span>
        <h1>Waiter</h1>
        <p className="muted">
          Signed in as {user?.fullName}. Ordering UI arrives in Phase 4b.
        </p>
      </div>
    </div>
  );
}
