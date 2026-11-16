import { Link, useLocation, useNavigate } from 'react-router-dom';
import { homePathForRole, useAuth } from '../auth/AuthContext';
import { DEFAULT_LOGO, useBranding } from '../branding/BrandingContext';
import { loginPathForTerminal } from '../lib/terminal';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
  WAITER: 'Waiter',
  KITCHEN: 'Kitchen',
};

interface NavItem {
  to: string;
  label: string;
}

function linksForRole(role: string): NavItem[] {
  switch (role) {
    case 'WAITER':
      return [
        { to: '/waiter', label: 'Tables' },
        { to: '/waiter/orders', label: 'My Orders' },
        { to: '/waiter/sales', label: 'My Sales' },
        { to: '/about', label: 'About' },
      ];
    case 'CASHIER':
      return [
        { to: '/cashier', label: 'Home' },
        { to: '/cashier/orders', label: 'Orders' },
        { to: '/cashier/sold-out', label: 'Sold Out' },
        { to: '/reports', label: 'Reports' },
        { to: '/about', label: 'About' },
      ];
    case 'MANAGER':
    case 'ADMIN':
      // Section navigation lives in the manager tab bar.
      return [];
    case 'KITCHEN':
      return [
        { to: '/kitchen', label: 'Kitchen Display' },
        { to: '/about', label: 'About' },
      ];
    default:
      return [];
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isNavActive(path: string, to: string): boolean {
  // '/waiter/orders' is its own page; only a single order (/waiter/order/:id)
  // belongs to the Tables section.
  if (to === '/waiter') return path === '/waiter' || path.startsWith('/waiter/order/');
  if (to === '/cashier' || to === '/manager') return path === to;
  return path === to || path.startsWith(to + '/');
}

export function Nav() {
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const navigate = useNavigate();
  const location = useLocation();

  if (!user) return null;

  const links = linksForRole(user.role);

  const onLogout = () => {
    logout();
    navigate(loginPathForTerminal(), { replace: true });
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to={homePathForRole(user.role)} className="topbar-brand">
          <img
            src={branding.restaurantLogo ?? DEFAULT_LOGO}
            alt=""
            className="topbar-logo topbar-logo-img"
          />
          <span className="topbar-brand-text">
            {branding.restaurantName}
            <span className="topbar-brand-sub">Point of Sale</span>
          </span>
        </Link>

        {links.length > 0 && (
          <nav className="topbar-links" aria-label="Main navigation">
            {links.map((item) => {
              const active = isNavActive(location.pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={active ? 'topbar-link topbar-link-active' : 'topbar-link'}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="topbar-account">
          <span className="topbar-avatar" aria-hidden="true">{initials(user.fullName)}</span>
          <span className="topbar-account-text">
            <span className="topbar-name">{user.fullName}</span>
            <span className="topbar-role">{ROLE_LABEL[user.role] ?? user.role}</span>
          </span>
          <button className="topbar-signout" onClick={onLogout} type="button">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
