import { useLocation } from 'react-router-dom';

const LABELS: Record<string, string> = {
  users: 'Users management',
  categories: 'Categories management',
  products: 'Products management',
  settings: 'Restaurant & printer settings',
};

export function ManagerPlaceholder() {
  const { pathname } = useLocation();
  const segment = pathname.split('/').filter(Boolean)[1] ?? '';
  const label = LABELS[segment] ?? 'This section';
  return (
    <div className="page manager-page">
      <div className="manager-placeholder">
        <p className="muted">{label} — coming in a future update.</p>
      </div>
    </div>
  );
}
