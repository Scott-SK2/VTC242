import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore, homeForRole, isAdminRole } from '@/shared/store/auth';
import { meApi } from '@/shared/api/endpoints';
import type { Role } from '@/shared/api/types';
import { FullPageSpinner } from '@/shared/ui/Spinner';
import { useTranslation } from 'react-i18next';

function useSession() {
  const refresh = useAuthStore((s) => s.refreshToken);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const u = await meApi.get();
      setUser(u);
      return u;
    },
    enabled: !!refresh,
    staleTime: 60_000,
    retry: false,
  });
  return {
    authenticated: !!refresh,
    user: user ?? query.data ?? null,
    loading: !!refresh && !user && query.isPending,
  };
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { authenticated, loading } = useSession();
  const loc = useLocation();
  if (!authenticated) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (loading) return <FullPageSpinner />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { authenticated, user, loading } = useSession();
  const loc = useLocation();
  const { t } = useTranslation();
  const wantsAdmin = roles.some(isAdminRole);
  if (!authenticated)
    return <Navigate to={wantsAdmin ? '/admin/login' : '/login'} replace state={{ from: loc.pathname }} />;
  if (loading || !user) return <FullPageSpinner />;
  if (!roles.includes(user.role)) {
    if (isAdminRole(user.role) || user.role === 'passenger' || user.role === 'driver') {
      return <Navigate to={homeForRole(user.role)} replace />;
    }
    return <p className="p-6 text-center">{t('auth.notAllowed')}</p>;
  }
  return <>{children}</>;
}

export function RootRedirect() {
  const { authenticated, user, loading } = useSession();
  if (!authenticated) return <Navigate to="/login" replace />;
  if (loading || !user) return <FullPageSpinner />;
  return <Navigate to={homeForRole(user.role)} replace />;
}
