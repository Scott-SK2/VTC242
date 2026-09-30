import { useState, type ReactNode } from 'react';

/** Panneau glissant au-dessus de la carte (mobile-first). */
export function Sheet({
  children,
  title,
  collapsible = true,
}: {
  children: ReactNode;
  title?: string;
  collapsible?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="sheet" aria-label={title}>
      {collapsible && (
        <button
          type="button"
          className="mx-auto mt-2 mb-1 h-8 w-16 flex items-center justify-center"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Déplier le panneau' : 'Replier le panneau'}
          aria-expanded={!collapsed}
        >
          <span className="block h-1.5 w-12 rounded-full bg-gray-300" />
        </button>
      )}
      {title && <h2 className="px-4 pb-2 text-lg font-extrabold">{title}</h2>}
      <div className={`px-4 pb-4 overflow-y-auto ${collapsed ? 'hidden' : ''}`}>{children}</div>
    </section>
  );
}
