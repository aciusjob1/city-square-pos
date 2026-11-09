import { useAuth } from '../../auth/AuthContext';

export function CashierHome() {
  const { user } = useAuth();
  return (
    <div className="page">
      <div className="placeholder card">
        <span className="role">CASHIER</span>
        <h1>Cashier</h1>
        <p className="muted">
          Signed in as {user?.fullName}. Bill viewing arrives in Phase 4b.
        </p>
      </div>
    </div>
  );
}
