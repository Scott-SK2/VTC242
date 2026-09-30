import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi, adminApi } from '@/shared/api/endpoints';
import { isApiError } from '@/shared/api/client';
import { useAuthStore, isAdminRole } from '@/shared/store/auth';
import { normalizePhone, isValidCongoPhone } from '@/shared/utils/phone';
import { Button, TextField, ErrorBox } from '@/shared/ui';
import type { TotpSetup } from '@/shared/api/types';

type Step = 'phone' | 'code' | 'totp';

/** Connexion back-office : OTP SMS puis étape TOTP obligatoire (admin, finance). */
export default function AdminLoginPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const auth = useAuthStore();
  const [step, setStep] = useState<Step>(() =>
    params.get('step') === 'totp' && auth.refreshToken ? 'totp' : 'phone',
  );
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [totp, setTotp] = useState('');
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [debugCode, setDebugCode] = useState<string | null>(null);

  useEffect(() => {
    if (step === 'totp' && auth.user && auth.user.role === 'support') nav('/admin', { replace: true });
  }, [step, auth.user, nav]);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setRaw(null);
    if (!isValidCongoPhone(phone)) return setError(t('auth.phoneInvalid'));
    setLoading(true);
    try {
      const r = await authApi.requestOtp(normalizePhone(phone));
      setDebugCode(r.debug_code ?? null);
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
    setLoading(true);
    try {
      const res = await authApi.verifyOtp(normalizePhone(phone), code);
      if (!isAdminRole(res.user.role)) {
        setError(t('auth.notAllowed'));
        return;
      }
      auth.setTokens(res.access, res.refresh);
      auth.setUser(res.user);
      if (res.user.role === 'support') {
        auth.setTotpVerified(true);
        nav('/admin', { replace: true });
      } else setStep('totp');
    } catch (err) {
      if (isApiError(err) && err.status === 423) setError(t('auth.locked'));
      else if (isApiError(err) && err.status === 400) setError(t('auth.invalidCodeShort'));
      else setRaw(err);
    } finally {
      setLoading(false);
    }
  }

  async function startSetup() {
    setLoading(true);
    setRaw(null);
    try {
      setSetup(await adminApi.totpSetup());
    } catch (err) {
      setRaw(err);
    } finally {
      setLoading(false);
    }
  }

  async function verifyTotp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setRaw(null);
    setLoading(true);
    try {
      const r = await adminApi.totpVerify(totp);
      if (r?.access) auth.setAccessToken(r.access);
      auth.setTotpVerified(true);
      if (auth.user && !auth.user.totp_enabled) auth.setUser({ ...auth.user, totp_enabled: true });
      nav('/admin', { replace: true });
    } catch (err) {
      if (isApiError(err) && (err.status === 400 || err.status === 403)) setError(t('auth.totpInvalid'));
      else setRaw(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full bg-slate flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm bg-white rounded-2xl p-6">
        <h1 className="text-xl font-extrabold">{t('auth.adminTitle')}</h1>
        <p className="text-gray-600 mb-4 text-sm">{t('auth.adminSubtitle')}</p>
        {step === 'phone' && (
          <form onSubmit={sendCode} noValidate>
            <TextField
              label={t('auth.phoneLabel')}
              type="tel"
              inputMode="tel"
              placeholder={t('auth.phonePlaceholder')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              error={error}
            />
            <ErrorBox error={raw} />
            <Button type="submit" variant="dark" block loading={loading} className="mt-2">
              {t('auth.sendCode')}
            </Button>
          </form>
        )}
        {step === 'code' && (
          <form onSubmit={verify} noValidate>
            {debugCode && (
              <p className="mb-3 rounded-xl bg-code-light px-3 py-2 text-sm">
                {t('auth.debugCode', { code: debugCode })}
              </p>
            )}
            <TextField
              label={t('auth.codeLabel')}
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              error={error}
              autoFocus
              className="text-center text-2xl tracking-[0.5em] font-extrabold"
            />
            <ErrorBox error={raw} />
            <Button
              type="submit"
              variant="dark"
              block
              loading={loading}
              disabled={code.length !== 6}
              className="mt-2"
            >
              {t('auth.verify')}
            </Button>
            <Button variant="ghost" block className="mt-2" onClick={() => setStep('phone')}>
              {t('auth.changePhone')}
            </Button>
          </form>
        )}
        {step === 'totp' && (
          <form onSubmit={verifyTotp} noValidate>
            <h2 className="font-extrabold">
              {auth.user?.totp_enabled ? t('auth.totpTitle') : t('auth.totpSetupTitle')}
            </h2>
            <p className="text-sm text-gray-600 mb-3">
              {auth.user?.totp_enabled ? t('auth.totpSubtitle') : t('auth.totpSetupHint')}
            </p>
            {!auth.user?.totp_enabled && !setup && (
              <Button
                variant="secondary"
                block
                className="mb-3"
                loading={loading}
                onClick={() => void startSetup()}
              >
                {t('auth.totpSetupButton')}
              </Button>
            )}
            {setup && (
              <div className="mb-3 rounded-xl bg-gray-100 p-3 text-sm break-all">
                <div className="font-semibold">{t('auth.totpSecret')}</div>
                <code className="block text-lg tracking-wider">{setup.secret}</code>
                <a href={setup.otpauth_url} className="text-brand-dark underline">
                  otpauth://
                </a>
              </div>
            )}
            <TextField
              label={t('auth.totpCode')}
              inputMode="numeric"
              maxLength={6}
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
              error={error}
              autoFocus
              className="text-center text-2xl tracking-[0.5em] font-extrabold"
            />
            <ErrorBox error={raw} />
            <Button
              type="submit"
              variant="dark"
              block
              loading={loading}
              disabled={totp.length !== 6}
              className="mt-2"
            >
              {t('auth.verify')}
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="text-gray-500 underline">
            {t('auth.title')} {t('roles.passenger').toLowerCase()} / {t('roles.driver').toLowerCase()}
          </Link>
        </p>
      </div>
    </div>
  );
}
