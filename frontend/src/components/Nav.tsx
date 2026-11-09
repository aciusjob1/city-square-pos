import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const canWaiter  = user.role === 'WAITER';
  const canCashier = user.role === 'CASHIER';
  const canManager = user.role === 'MANAGER' || user.role === 'ADMIN';
  const canKitchen = user.role === 'KITCHEN';

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <nav className="nav">
      <span className="brand">City Square</span>
      {canWaiter && <Link to="/waiter">Orders</Link>}
      {canCashier && <Link to="/cashier">Cashier</Link>}
      {canManager && <Link to="/manager">Manager</Link>}
      {canKitchen && <Link to="/kitchen">Kitchen</Link>}
      <button onClick={onLogout}>Sign out</button>
    </nav>
  );
}
