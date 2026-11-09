import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth, homePathForRole } from './AuthContext';
import type { Role } from '../lib/types';

interface Props {
  children: ReactNode;
  allow?: Role[];
}

export function ProtectedRoute({ children, allow }: Props) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return <div className="page"><p className="muted">Loading…</p></div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (allow && !allow.includes(user.role)) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  return <>{children}</>;
}
