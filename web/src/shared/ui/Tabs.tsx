export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className = '',
}: {
  value: T;
  onChange: (v: T) => void;
  items: Array<{ value: T; label: string }>;
  className?: string;
}) {
  return (
    <div role="tablist" className={`flex rounded-xl bg-gray-100 p-1 ${className}`}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          type="button"
          aria-selected={it.value === value}
          onClick={() => onChange(it.value)}
          className={`flex-1 rounded-lg min-h-[44px] px-3 text-sm font-semibold transition-colors ${
            it.value === value ? 'bg-white shadow text-ink' : 'text-gray-600'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
