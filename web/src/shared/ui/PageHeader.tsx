import type { ReactNode } from 'react';

export function MobilePage({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-extrabold">{title}</h1>
        {action}
      </header>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}
