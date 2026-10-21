import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/shared/store/auth';
import { authApi } from '@/shared/api/endpoints';
import { useQueryClient } from '@tanstack/react-query';
import { useWsStatus } from '@/shared/ws';

const NAV: Array<{ to: string; key: string; roles?: string[]; end?: boolean }> = [
  { to: '/admin', key: 'dashboard', end: true },
  { to: '/admin/fleet', key: 'fleet' },
  { to: '/admin/alerts', key: 'alerts' },
  { to: '/admin/rides', key: 'rides' },
  { to: '/admin/drivers', key: 'drivers' },
  { to: '/admin/passengers', key: 'passengers' },
  { to: '/admin/pricing', key: 'pricing', roles: ['admin', 'finance'] },
  { to: '/admin/zones', key: 'zones', roles: ['admin'] },
  { to: '/admin/pois', key: 'pois', roles: ['admin', 'support'] },
  { to: '/admin/rentals', key: 'rentals' },
  { to: '/admin/carpool', key: 'carpool' },
  { to: '/admin/disputes', key: 'disputes' },
  { to: '/admin/finance', key: 'finance', roles: ['admin', 'finance'] },
  { to: '/admin/audit', key: 'audit', roles: ['admin'] },
  { to: '/admin/users', key: 'users', roles: ['admin'] },
];

/** Layout back-office (N-01) : desktop-first, barre latérale repliable sous 1024 px, anthracite. */
export default function AdminLayout() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const totpVerified = useAuthStore((s) => s.totpVerified);
  const logout = useAuthStore((s) => s.logout);
  const refresh = useAuthStore((s) => s.refreshToken);
  const wsStatus = useWsStatus();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('vtc242.adminSidebar') === 'collapsed';
    } catch {
      return false;
    }
  });

  const needsTotp = !!user && user.role !== 'support' && !totpVerified;
  useEffect(() => {
    if (needsTotp) nav('/admin/login?step=totp', { replace: true });
  }, [needsTotp, nav]);
  useEffect(() => {
    const h = () => nav('/admin/login?step=totp', { replace: true });
    window.addEventListener('vtc:totp_required', h);
    return () => window.removeEventListener('vtc:totp_required', h);
  }, [nav]);

  async function doLogout() {
    try {
      if (refresh) await authApi.logout(refresh);
    } catch {
      /* ignoré */
    }
    logout();
    qc.clear();
    nav('/admin/login', { replace: true });
  }

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('vtc242.adminSidebar', c ? 'open' : 'collapsed');
      } catch {
        /* ignoré */
      }
      return !c;
    });
  };
  const items = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));

  return (
    <div className="h-full flex bg-gray-50">
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 bg-slate text-white flex flex-col transition-transform lg:transition-[width] ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} ${collapsed ? 'lg:w-16 w-64' : 'w-64'}`}
        aria-label={t('common.menu')}
      >
        <div className="flex items-center gap-2 px-4 h-14 border-b border-white/10">
          <span className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center font-extrabold text-sm shrink-0">
            242
          </span>
          {!collapsed && <span className="font-extrabold truncate">{t('admin.title')}</span>}
          <button
            type="button"
            className="ml-auto hidden lg:block min-h-tap min-w-tap"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          >
            {collapsed ? '»' : '«'}
          </button>
          <button
            type="button"
            className="ml-auto lg:hidden min-h-tap min-w-tap"
            onClick={() => setOpen(false)}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setOpen(false)}
              title={t(`nav.${n.key}`)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 min-h-[44px] text-sm font-semibold ${isActive ? 'bg-white/15 border-l-4 border-brand' : 'hover:bg-white/10 border-l-4 border-transparent'}`
              }
            >
              <span className="w-5 text-center" aria-hidden="true">
                {ICONS[n.key] ?? '•'}
              </span>
              {!collapsed && <span className="truncate">{t(`nav.${n.key}`)}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3 text-xs">
          {!collapsed && user && (
            <div className="truncate mb-1">
              {user.first_name} {user.last_name} · {t(`roles.${user.role}`)}
            </div>
          )}
          <button type="button" className="underline min-h-[32px]" onClick={() => void doLogout()}>
            {collapsed ? '⏻' : t('common.logout')}
          </button>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shrink-0">
          <button
            type="button"
            className="lg:hidden min-h-tap min-w-tap -ml-2"
            onClick={() => setOpen(true)}
            aria-label={t('common.menu')}
          >
            ☰
          </button>
          <span className="font-extrabold">{t('app.name')}</span>
          <span
            className={`ml-auto text-xs rounded-full px-2 py-0.5 ${wsStatus === 'open' ? 'bg-brand-light text-brand-dark' : 'bg-gray-100 text-gray-600'}`}
            role="status"
          >
            {wsStatus === 'open' ? t('admin.dashboard.live') : t('common.wsReconnecting')}
          </span>
        </header>
        <main className="flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const ICONS: Record<string, string> = {
  dashboard: '▦',
  fleet: '⌖',
  alerts: '!',
  rides: '⇄',
  drivers: '⚲',
  passengers: '☺',
  pricing: '₣',
  zones: '⬠',
  pois: '★',
  disputes: '⚖',
  finance: '∑',
  audit: '≡',
  users: '⚙',
};
