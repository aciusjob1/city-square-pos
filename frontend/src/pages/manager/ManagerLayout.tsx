import { NavLink, Outlet } from 'react-router-dom';
import './ManagerLayout.css';

const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: '/manager', label: 'Dashboard', end: true },
  { to: '/manager/users', label: 'Users' },
  { to: '/manager/categories', label: 'Categories' },
  { to: '/manager/products', label: 'Products' },
  { to: '/manager/settings', label: 'Settings' },
];

export function ManagerLayout() {
  return (
    <>
      <nav className="manager-tabs" aria-label="Manager sections">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              'manager-tab' + (isActive ? ' manager-tab-active' : '')
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
