import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth, homePathForRole } from './AuthContext';
import type { Role } from '../lib/types';

interface Props {
  children: ReactNode;
  allow?: Role[];
}

/**
 * SECURITY BOUNDARY
 *
 * This route guard is a UX layer — it prevents users from landing on pages
 * that don't apply to their role. It is NOT the security boundary.
 *
 * The actual security boundary is on the backend:
 *   - Every protected API call requires a valid JWT (JwtAuthGuard).
 *   - Every role-restricted endpoint enforces @Roles(...) with RolesGuard.
 *
 * Do not weaken, remove, or bypass the backend guards "because the frontend
 * blocks it anyway." The frontend is not authoritative.
 */
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
