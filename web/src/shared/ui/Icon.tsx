/** Icônes au trait (24 × 24), cohérentes sur tous les écrans, à la place des emojis. */
const PATHS = {
  car: 'M5 17h14M6 17v2M18 17v2M4 13l2-5a2 2 0 0 1 1.9-1.3h8.2A2 2 0 0 1 18 8l2 5M4 13h16v4H4zM7.5 15h.01M16.5 15h.01',
  users:
    'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  ticket: 'M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3zM13 4v16',
  swap: 'M7 7h13l-3-3M17 17H4l3 3',
  steering:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3.5 10.5l6.6 1M13.9 11.5l6.6-1M12 14v7',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  chevron: 'M9 6l6 6-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  key: 'M14 10a4 4 0 1 0-3.5 4L4 20.5V22h3v-2h2v-2l3.5-3.5A4 4 0 0 0 14 10zM15 8h.01',
  phone: 'M7 3h10v18H7zM11 18h2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  route:
    'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 24,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Pastille d'icône teintée (tuiles de services, en-têtes de cartes). */
export function IconBadge({
  name,
  tone = 'brand',
  size = 44,
}: {
  name: IconName;
  tone?: 'brand' | 'amber' | 'blue' | 'gray';
  size?: number;
}) {
  const tones = {
    brand: 'bg-brand-light text-brand-dark',
    amber: 'bg-code-light text-yellow-800',
    blue: 'bg-blue-50 text-blue-700',
    gray: 'bg-gray-100 text-gray-700',
  } as const;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-2xl shrink-0 ${tones[tone]}`}
      style={{ width: size, height: size }}
    >
      <Icon name={name} size={Math.round(size * 0.5)} />
    </span>
  );
}
