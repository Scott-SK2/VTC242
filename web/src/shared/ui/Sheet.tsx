import { useRef, useState, type PointerEvent, type ReactNode } from 'react';

/**
 * Panneau glissant au-dessus de la carte (mobile-first). Glisser la poignée vers le bas (ou la
 * toucher) le rétracte : seul le haut du contenu reste visible et la carte redevient utilisable ;
 * glisser vers le haut (ou toucher à nouveau) le déplie.
 */
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
  const start = useRef<number | null>(null);
  const moved = useRef(false);

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    start.current = e.clientY;
    moved.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerUp(e: PointerEvent<HTMLButtonElement>) {
    if (start.current === null) return;
    const dy = e.clientY - start.current;
    start.current = null;
    if (dy > 24) {
      moved.current = true;
      setCollapsed(true);
    } else if (dy < -24) {
      moved.current = true;
      setCollapsed(false);
    }
  }

  return (
    <section className="sheet" aria-label={title}>
      {collapsible && (
        <button
          type="button"
          className="mx-auto mt-1 h-7 w-full max-w-[160px] flex items-center justify-center touch-none"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onClick={() => {
            if (!moved.current) setCollapsed((c) => !c);
            moved.current = false;
          }}
          aria-label={collapsed ? 'Déplier le panneau' : 'Replier le panneau'}
          aria-expanded={!collapsed}
        >
          <span className="block h-1.5 w-12 rounded-full bg-gray-300" />
        </button>
      )}
      {title && <h2 className="px-4 pb-2 text-lg font-extrabold">{title}</h2>}
      <div
        className={`px-4 ${collapsed ? 'max-h-[84px] overflow-hidden pb-2' : 'pb-4 overflow-y-auto'}`}
        style={collapsed ? { maskImage: 'linear-gradient(to bottom, black 70%, transparent)' } : undefined}
      >
        {children}
      </div>
    </section>
  );
}
