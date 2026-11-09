import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!user) return null;

  const isWaiter = user.role === 'WAITER';
  const isCashier = user.role === 'CASHIER';
  const isManager = user.role === 'MANAGER' || user.role === 'ADMIN';
  const isKitchen = user.role === 'KITCHEN';

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const navLink = (to: string, label: string) => {
    const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
    return <Link to={to} className={active ? 'active' : undefined}>{label}</Link>;
  };

  return (
    <nav className="nav">
      <span className="brand">City Square</span>
      {isWaiter && navLink('/waiter', 'Tables')}
      {isWaiter && navLink('/waiter/orders', 'My Orders')}
      {isCashier && <Link to="/cashier">Cashier</Link>}
      {isManager && <Link to="/manager">Manager</Link>}
      {isKitchen && <Link to="/kitchen">Kitchen</Link>}
      <button onClick={onLogout}>Sign out</button>
    </nav>
  );
}
