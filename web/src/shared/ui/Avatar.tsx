export function Avatar({ src, name, size = 56 }: { src?: string | null; name: string; size?: number }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return src ? (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className="rounded-full bg-brand-light text-brand-dark font-extrabold flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}
