import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { RequireRole, RootRedirect } from './guards';
import { MobileLayout } from './layouts/MobileLayout';
import { FullPageSpinner } from '@/shared/ui/Spinner';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OfflinePage } from './pages/OfflinePage';
import { InstallPage } from './pages/InstallPage';
import { RootLayout } from './layouts/RootLayout';

const lazyPage = (loader: () => Promise<{ default: React.ComponentType }>) => {
  const C = lazy(loader);
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <C />
    </Suspense>
  );
};

const P = {
  home: () => import('@/features/passenger/pages/HomePage'),
  ride: () => import('@/features/passenger/pages/RidePage'),
  wallet: () => import('@/features/passenger/pages/WalletPage'),
  rides: () => import('@/features/passenger/pages/RidesPage'),
  profile: () => import('@/features/passenger/pages/ProfilePage'),
  share: () => import('@/features/passenger/pages/SharePage'),
};
const D = {
  home: () => import('@/features/driver/pages/HomePage'),
  onboarding: () => import('@/features/driver/pages/OnboardingPage'),
  wallet: () => import('@/features/driver/pages/WalletPage'),
  rides: () => import('@/features/driver/pages/RidesPage'),
  profile: () => import('@/features/driver/pages/ProfilePage'),
};
const A = {
  layout: () => import('@/features/admin/AdminLayout'),
  login: () => import('@/features/admin/pages/AdminLoginPage'),
  dashboard: () => import('@/features/admin/pages/DashboardPage'),
  fleet: () => import('@/features/admin/pages/FleetPage'),
  alerts: () => import('@/features/admin/pages/AlertsPage'),
  rides: () => import('@/features/admin/pages/RidesPage'),
  ride: () => import('@/features/admin/pages/RideDetailPage'),
  drivers: () => import('@/features/admin/pages/DriversPage'),
  passengers: () => import('@/features/admin/pages/PassengersPage'),
  pricing: () => import('@/features/admin/pages/PricingPage'),
  zones: () => import('@/features/admin/pages/ZonesPage'),
  pois: () => import('@/features/admin/pages/PoisPage'),
  disputes: () => import('@/features/admin/pages/DisputesPage'),
  finance: () => import('@/features/admin/pages/FinancePage'),
  audit: () => import('@/features/admin/pages/AuditPage'),
  users: () => import('@/features/admin/pages/UsersPage'),
};

const AdminLayoutLazy = lazy(A.layout);
const adminShell: ReactNode = (
  <RequireRole roles={['admin', 'finance', 'support']}>
    <Suspense fallback={<FullPageSpinner />}>
      <AdminLayoutLazy />
    </Suspense>
  </RequireRole>
);

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <NotFoundPage />,
    children: [
      { path: '/', element: <RootRedirect /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/offline', element: <OfflinePage /> },
      { path: '/install', element: <InstallPage /> },
      { path: '/share/:token', element: lazyPage(P.share) },
      {
        path: '/p',
        element: (
          <RequireRole roles={['passenger']}>
            <MobileLayout role="passenger" />
          </RequireRole>
        ),
        children: [
          { index: true, element: lazyPage(P.home) },
          { path: 'ride/:id', element: lazyPage(P.ride) },
          { path: 'wallet', element: lazyPage(P.wallet) },
          { path: 'rides', element: lazyPage(P.rides) },
          { path: 'profile', element: lazyPage(P.profile) },
        ],
      },
      {
        path: '/d',
        element: (
          <RequireRole roles={['driver']}>
            <MobileLayout role="driver" />
          </RequireRole>
        ),
        children: [
          { index: true, element: lazyPage(D.home) },
          { path: 'onboarding', element: lazyPage(D.onboarding) },
          { path: 'wallet', element: lazyPage(D.wallet) },
          { path: 'rides', element: lazyPage(D.rides) },
          { path: 'profile', element: lazyPage(D.profile) },
        ],
      },
      { path: '/admin/login', element: lazyPage(A.login) },
      {
        path: '/admin',
        element: adminShell,
        children: [
          { index: true, element: lazyPage(A.dashboard) },
          { path: 'fleet', element: lazyPage(A.fleet) },
          { path: 'alerts', element: lazyPage(A.alerts) },
          { path: 'rides', element: lazyPage(A.rides) },
          { path: 'rides/:id', element: lazyPage(A.ride) },
          { path: 'drivers', element: lazyPage(A.drivers) },
          { path: 'drivers/:id', element: lazyPage(A.drivers) },
          { path: 'passengers', element: lazyPage(A.passengers) },
          { path: 'pricing', element: lazyPage(A.pricing) },
          { path: 'zones', element: lazyPage(A.zones) },
          { path: 'pois', element: lazyPage(A.pois) },
          { path: 'disputes', element: lazyPage(A.disputes) },
          { path: 'disputes/:id', element: lazyPage(A.disputes) },
          { path: 'finance', element: lazyPage(A.finance) },
          { path: 'audit', element: lazyPage(A.audit) },
          { path: 'users', element: lazyPage(A.users) },
        ],
      },
      { path: '/p/*', element: <Navigate to="/p" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
