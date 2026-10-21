import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/shared/api/endpoints';
import { isApiError } from '@/shared/api/client';
import type { OtpVerifyResponse } from '@/shared/api/types';
import { useAuthStore, homeForRole } from '@/shared/store/auth';
import { normalizePhone, isValidCongoPhone } from '@/shared/utils/phone';
import { Button, TextField, ErrorBox } from '@/shared/ui';

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
  const [mismatch, setMismatch] = useState<{
    role: 'passenger' | 'driver';
    dest: string;
    res: OtpVerifyResponse;
  } | null>(null);
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
      const dest = from && from.startsWith(homeForRole(res.user.role)) ? from : homeForRole(res.user.role);
      if (
        !res.created &&
        res.user.role !== role &&
        (res.user.role === 'passenger' || res.user.role === 'driver')
      ) {
        // F-05 : un compte a un seul rôle ; on prévient avant d'ouvrir la session
        setMismatch({ role: res.user.role, dest, res });
        return;
      }
      setTokens(res.access, res.refresh);
      setUser(res.user);
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
    <div className="min-h-full flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 h-16 w-16 rounded-2xl bg-brand text-white flex items-center justify-center text-2xl font-extrabold">
            242
          </div>
          <h1 className="text-2xl font-extrabold">{t('app.name')}</h1>
          <p className="text-gray-600">{t('app.tagline')}</p>
        </div>

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
                    className={`cursor-pointer rounded-xl border p-3 min-h-tap ${role === r ? 'border-brand bg-brand-light' : 'border-gray-300'}`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={r}
                      className="sr-only"
                      checked={role === r}
                      onChange={() => setRole(r)}
                    />
                    <span className="block font-semibold">
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
            {mismatch ? (
              <div className="mt-3 rounded-xl bg-code-light p-3 text-sm" role="alert">
                <p className="mb-3">{t('auth.roleMismatch', { role: t(`roles.${mismatch.role}`) })}</p>
                <Button
                  block
                  onClick={() => {
                    setTokens(mismatch.res.access, mismatch.res.refresh);
                    setUser(mismatch.res.user);
                    nav(mismatch.dest, { replace: true });
                  }}
                >
                  {t('auth.continueAs', { role: t(`roles.${mismatch.role}`) })}
                </Button>
              </div>
            ) : (
              <Button type="submit" block loading={loading} className="mt-3">
                {t('auth.verify')}
              </Button>
            )}
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
  );
}
