import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { moduleForPath, usePermissions } from './usePermissions';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const { can, landingPath } = usePermissions();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Typing the URL of a module you weren't given lands you on your own first section instead
  // of a broken page. The server refuses the data either way — this is just the tidy version.
  const required = moduleForPath(location.pathname);
  if (required && !can(required)) {
    return <Navigate to={landingPath} replace />;
  }

  return <>{children}</>;
}
