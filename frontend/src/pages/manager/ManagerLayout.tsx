import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import './ManagerLayout.css';

const STORAGE_KEY = 'cspos.sidebar.collapsed';

interface Tab {
  to: string;
  label: string;
  end?: boolean;
  icon: string;
}

const TABS: Tab[] = [
  { to: '/manager', label: 'Dashboard', end: true, icon: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z' },
  { to: '/manager/orders', label: 'Orders', icon: 'M6 3h12a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 0 1 1-1Zm2 5v2h8V8H8Zm0 4v2h8v-2H8Z' },
  { to: '/manager/reports', label: 'Reports', icon: 'M4 20V10h4v10H4Zm6 0V4h4v16h-4Zm6 0v-7h4v7h-4Z' },
  { to: '/manager/users', label: 'Users', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8a8 8 0 0 1 16 0H4Z' },
  { to: '/manager/categories', label: 'Categories', icon: 'M3 4h8l10 10-7 7L3 12V4Zm4.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z' },
  { to: '/manager/products', label: 'Products', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 2.3L6.5 8.4 12 11.5l5.5-3.1L12 5.3Z' },
  { to: '/manager/sold-out', label: 'Sold Out', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 0 1 4.9 12L7 7.1A7 7 0 0 1 12 5Zm0 14a7 7 0 0 1-4.9-12L17 16.9A7 7 0 0 1 12 19Z' },
  { to: '/manager/stock', label: 'Stock', icon: 'M12 3l9 5-9 5-9-5 9-5Zm0 2.3L6.4 8 12 10.7 17.6 8 12 5.3ZM3 12l9 5 9-5v2l-9 5-9-5v-2Z' },
  { to: '/manager/print-jobs', label: 'Print Jobs', icon: 'M7 3h10v4H7V3Zm-2 6h14a2 2 0 0 1 2 2v5h-4v4H7v-4H3v-5a2 2 0 0 1 2-2Zm4 7v2h6v-2H9Z' },
  { to: '/manager/settings', label: 'Settings', icon: 'M4 6h16v2H4V6Zm0 5h10v2H4v-2Zm0 5h16v2H4v-2Z' },
  { to: '/about', label: 'About', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a1.2 1.2 0 1 1 0 2.4A1.2 1.2 0 0 1 12 7Zm-1 4h2v6h-2v-6Z' },
];

function TabIcon({ path }: { path: string }) {
  return (
    <svg className="manager-tab-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function ManagerLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === '1' || stored === '0') return stored === '1';
      // A desktop window narrower than the sidebar breakpoint (old monitor or
      // display scaling) starts as the icon rail so content still fits.
      const desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      return desktop && window.innerWidth < 1024;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage unavailable — keep in-memory state */
    }
  }, [collapsed]);

  return (
    <div className={'manager-shell' + (collapsed ? ' manager-shell-collapsed' : '')}>
      <nav className="manager-tabs" aria-label="Manager sections">
        <button
          type="button"
          className="manager-sidebar-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            title={collapsed ? t.label : undefined}
            aria-label={t.label}
            className={({ isActive }) =>
              'manager-tab' + (isActive ? ' manager-tab-active' : '')
            }
          >
            <TabIcon path={t.icon} />
            <span className="manager-tab-label">{t.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="manager-content">
        <Outlet />
      </div>
    </div>
  );
}
