import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const icons = {
  home: 'M3 11 12 3l9 8v10h-6v-6H9v6H3z',
  wallet: 'M3 7h18v12H3zM3 10h18M15 14h3',
  rides: 'M4 17h16M6 17l1-6h10l1 6M8 11V7h8v4',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 8a8 8 0 0 1 16 0',
};

export function MobileLayout({ role }: { role: 'passenger' | 'driver' }) {
  const { t } = useTranslation();
  const base = role === 'passenger' ? '/p' : '/d';
  const items = [
    { to: base, label: t('nav.home'), icon: icons.home, end: true },
    { to: `${base}/wallet`, label: t('nav.wallet'), icon: icons.wallet },
    { to: `${base}/rides`, label: t('nav.rides'), icon: icons.rides },
    { to: `${base}/profile`, label: t('nav.profile'), icon: icons.profile },
  ];
  return (
    <div className="h-full flex flex-col max-w-screen-md mx-auto w-full">
      <main className="flex-1 min-h-0 relative overflow-hidden">
        <Outlet />
      </main>
      <nav
        className="shrink-0 border-t border-gray-200 bg-white"
        aria-label="Navigation principale"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <ul className="grid grid-cols-4">
          {items.map((it) => (
            <li key={it.to}>
              <NavLink
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-xs font-semibold ${isActive ? 'text-brand' : 'text-gray-500'}`
                }
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={it.icon} />
                </svg>
                {it.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
