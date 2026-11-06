import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const icons = {
  home: 'M3 11 12 3l9 8v10h-6v-6H9v6H3z',
  wallet: 'M3 7h18v12H3zM3 10h18M15 14h3',
  rides: 'M4 17h16M6 17l1-6h10l1 6M8 11V7h8v4',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 8a8 8 0 0 1 16 0',
  services: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
};

export function MobileLayout({ role }: { role: 'passenger' | 'driver' }) {
  const { t } = useTranslation();
  const base = role === 'passenger' ? '/p' : '/d';
  const items = [
    { to: base, label: t('nav.home'), icon: icons.home, end: true },
    { to: `${base}/wallet`, label: t('nav.wallet'), icon: icons.wallet },
    { to: `${base}/rides`, label: t('nav.rides'), icon: icons.rides },
    { to: `${base}/services`, label: t('nav.services'), icon: icons.services },
    { to: `${base}/profile`, label: t('nav.profile'), icon: icons.profile },
  ];
  return (
    <div className="h-full flex flex-col max-w-screen-md mx-auto w-full">
      <main className="flex-1 min-h-0 relative overflow-hidden">
        <Outlet />
      </main>
      <nav
        className="shrink-0 border-t border-gray-100 bg-white shadow-[0_-2px_12px_rgba(17,19,24,0.04)]"
        aria-label="Navigation principale"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <ul className="grid grid-cols-5">
          {items.map((it) => (
            <li key={it.to}>
              <NavLink
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  `group flex flex-col items-center justify-center gap-0.5 min-h-[60px] text-[11px] font-semibold ${isActive ? 'text-brand-dark' : 'text-gray-500'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`flex items-center justify-center h-8 w-14 rounded-full transition-colors ${isActive ? 'bg-brand-light' : ''}`}
                    >
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={isActive ? 2.4 : 2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d={it.icon} />
                      </svg>
                    </span>
                    {it.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
