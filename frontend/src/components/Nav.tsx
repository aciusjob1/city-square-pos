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

  const isActive = (to: string) =>
    location.pathname === to ||
    (to !== '/' && location.pathname.startsWith(to + '/')) ||
    (to === '/waiter' && location.pathname === '/waiter/orders');

  const navLink = (to: string, label: string) => (
    <Link
      to={to}
      className={isActive(to) ? 'active' : undefined}
    >
      {label}
    </Link>
  );

  return (
    <nav className="nav">
      <Link to="/" className="brand">City Square</Link>
      <div className="nav-links">
        {isWaiter && navLink('/waiter', 'Tables')}
        {isWaiter && navLink('/waiter/orders', 'My Orders')}
        {isCashier && <Link to="/cashier">Cashier</Link>}
        {isManager && <Link to="/manager">Manager</Link>}
        {isKitchen && <Link to="/kitchen">Kitchen</Link>}
        {(isWaiter || isCashier || isManager) && navLink('/print-jobs', 'Print Jobs')}
      </div>
      <div className="user-info">
        <span className="role-badge">{user.role}</span>
        <span>{user.fullName}</span>
      </div>
      <button className="signout" onClick={onLogout}>Sign out</button>
    </nav>
  );
}
