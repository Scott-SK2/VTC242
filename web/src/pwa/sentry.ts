/** Initialisation paresseuse de Sentry : rien n'est chargé sans DSN. */
export function setupSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  // Le SDK n'est pas une dépendance du projet pour préserver le bundle ; on charge la version navigateur du CDN.
  const s = document.createElement('script');
  s.src = 'https://browser.sentry-cdn.com/8.33.1/bundle.tracing.min.js';
  s.crossOrigin = 'anonymous';
  s.onload = () => {
    const Sentry = (window as unknown as { Sentry?: { init: (o: Record<string, unknown>) => void } }).Sentry;
    Sentry?.init({ dsn, tracesSampleRate: 0.1, environment: import.meta.env.MODE });
  };
  document.head.appendChild(s);
}
