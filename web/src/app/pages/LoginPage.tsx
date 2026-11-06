import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/shared/api/endpoints';
import { isApiError } from '@/shared/api/client';
import { useAuthStore, homeForRole } from '@/shared/store/auth';
import { normalizePhone, isValidCongoPhone } from '@/shared/utils/phone';
import { Button, TextField, ErrorBox, Icon } from '@/shared/ui';
import { toast } from '@/shared/store/ui';

type Step = 'phone' | 'code';

export function LoginPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const authenticated = useAuthStore((s) => !!s.refreshToken);
  const user = useAuthStore((s) => s.user);
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'passenger' | 'driver'>('passenger');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (authenticated && user) nav(homeForRole(user.role), { replace: true });
  }, [authenticated, user, nav]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setRaw(null);
    if (!isValidCongoPhone(phone)) {
      setError(t('auth.phoneInvalid'));
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.requestOtp(normalizePhone(phone));
      setDebugCode(res.debug_code ?? null);
      setResendAt(Date.now() + 30_000);
      setStep('code');
    } catch (err) {
      if (isApiError(err) && err.status === 429) setError(t('auth.tooMany'));
      else setRaw(err);
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setRaw(null);
    if (!/^\d{6}$/.test(code)) {
      setError(t('auth.invalidCodeShort'));
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.verifyOtp(normalizePhone(phone), code, role);
      const from = loc.state?.from;
      const home =
        res.user.role === 'driver' && !res.user.driver?.can_go_online
          ? '/d/onboarding'
          : homeForRole(res.user.role);
      const dest = from && from.startsWith(homeForRole(res.user.role)) ? from : home;
      setTokens(res.access, res.refresh);
      setUser(res.user);
      if (res.mode_note) toast(t('mode.loginNote', { reason: res.mode_note }), 'info');
      nav(dest, { replace: true });
    } catch (err) {
      if (isApiError(err) && err.status === 423) setError(t('auth.locked'));
      else if (isApiError(err) && err.status === 400) {
        const left = err.details?.attempts_left;
        setError(typeof left === 'number' ? t('auth.invalidCode', { left }) : t('auth.invalidCodeShort'));
      } else setRaw(err);
    } finally {
      setLoading(false);
    }
  }

  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  return (
    <div className="min-h-full flex flex-col bg-gray-50">
      <div className="relative overflow-hidden bg-gradient-to-br from-brand to-brand-dark text-white px-6 pt-10 pb-16">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" aria-hidden="true" />
        <div className="absolute right-16 top-24 h-16 w-16 rounded-full bg-white/10" aria-hidden="true" />
        <div className="relative max-w-sm mx-auto">
          <div className="h-14 w-14 rounded-2xl bg-white text-brand flex items-center justify-center text-xl font-extrabold shadow-lg">
            242
          </div>
          <h1 className="mt-5 text-3xl font-extrabold leading-tight">{t('auth.heroTitle')}</h1>
          <p className="mt-2 text-white/85 text-sm">{t('auth.heroPoints')}</p>
        </div>
      </div>
      <div className="flex-1 px-4 -mt-8 pb-8">
        <div className="relative z-10 w-full max-w-sm mx-auto card shadow-lg p-5">
          {step === 'phone' ? (
            <form onSubmit={sendCode} noValidate>
              <h2 className="text-xl font-extrabold mb-1">{t('auth.title')}</h2>
              <p className="text-gray-600 mb-4">{t('auth.subtitle')}</p>
              <TextField
                label={t('auth.phoneLabel')}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t('auth.phonePlaceholder')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                error={error}
                hint="+242"
              />
              <fieldset className="mb-4">
                <legend className="label">{t('auth.roleTitle')}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(['passenger', 'driver'] as const).map((r) => (
                    <label
                      key={r}
                      className={`cursor-pointer rounded-2xl border-2 p-3 min-h-tap transition-colors ${role === r ? 'border-brand bg-brand-light' : 'border-gray-200 bg-white'}`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={r}
                        className="sr-only"
                        checked={role === r}
                        onChange={() => setRole(r)}
                      />
                      <Icon
                        name={r === 'passenger' ? 'user' : 'steering'}
                        size={22}
                        className={role === r ? 'text-brand-dark mb-1' : 'text-gray-500 mb-1'}
                      />
                      <span className="block font-bold">
                        {t(`auth.role${r === 'passenger' ? 'Passenger' : 'Driver'}`)}
                      </span>
                      <span className="block text-sm text-gray-600">
                        {t(`auth.role${r === 'passenger' ? 'Passenger' : 'Driver'}Hint`)}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">{t('auth.roleHint')}</p>
              </fieldset>
              <ErrorBox error={raw} />
              <Button type="submit" block loading={loading} className="mt-3">
                {t('auth.sendCode')}
              </Button>
              <p className="mt-4 text-xs text-gray-500 text-center">{t('auth.terms')}</p>
              <p className="mt-6 text-center text-sm">
                <Link to="/admin/login" className="text-gray-500 underline">
                  {t('auth.adminTitle')}
                </Link>
              </p>
            </form>
          ) : (
            <form onSubmit={verify} noValidate>
              <h2 className="text-xl font-extrabold mb-1">{t('auth.codeTitle')}</h2>
              <p className="text-gray-600 mb-4">
                {debugCode
                  ? t('auth.testModeNoSms', { phone: normalizePhone(phone) })
                  : t('auth.codeSent', { phone: normalizePhone(phone) })}
              </p>
              {debugCode && (
                <p className="mb-3 rounded-xl bg-code-light px-3 py-2 text-sm" data-testid="debug-code">
                  {t('auth.debugCode', { code: debugCode })}
                </p>
              )}
              <TextField
                label={t('auth.codeLabel')}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                error={error}
                className="text-center text-2xl tracking-[0.5em] font-extrabold"
                autoFocus
              />
              <ErrorBox error={raw} />
              <Button type="submit" block loading={loading} className="mt-3">
                {t('auth.verify')}
              </Button>
              <div className="mt-3 flex justify-between">
                <Button variant="ghost" onClick={() => setStep('phone')}>
                  {t('auth.changePhone')}
                </Button>
                <Button variant="ghost" disabled={resendIn > 0} onClick={() => void sendCode()}>
                  {resendIn > 0 ? t('auth.resendIn', { s: resendIn }) : t('auth.resend')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
