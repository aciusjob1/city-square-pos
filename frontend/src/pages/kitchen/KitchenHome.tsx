import { useAuth } from '../../auth/AuthContext';

export function KitchenHome() {
  const { user } = useAuth();
  return (
    <div className="page">
      <div className="placeholder card">
        <span className="role">KITCHEN</span>
        <h1>Kitchen</h1>
        <p className="muted">
          Signed in as {user?.fullName}. Ticket display arrives in Phase 4b.
        </p>
      </div>
    </div>
  );
}
