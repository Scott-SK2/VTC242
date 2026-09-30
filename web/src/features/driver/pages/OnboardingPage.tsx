import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MobilePage,
  Button,
  Badge,
  Modal,
  TextField,
  SelectField,
  ErrorBox,
  ProfileForm,
  type BadgeTone,
} from '@/shared/ui';
import { driversApi, uploadFile } from '@/shared/api/endpoints';
import { qk } from '@/shared/api/hooks';
import type { DocumentType, DriverDocument, Vehicle, VehicleCategory } from '@/shared/api/types';
import { toast } from '@/shared/store/ui';
import { formatDate } from '@/shared/utils/date';

const DOC_TYPES: DocumentType[] = [
  'license',
  'registration',
  'insurance',
  'taxi_card',
  'id_card',
  'vehicle_photo',
  'profile_photo',
];
const CATEGORIES: VehicleCategory[] = ['taxi', 'standard', 'vip', 'wedding', 'moving'];
const tone: Record<string, BadgeTone> = {
  missing: 'neutral',
  pending: 'yellow',
  approved: 'green',
  rejected: 'red',
};

/** Onboarding chauffeur (F-30, F-31) : pièces via POST /me/uploads puis POST /drivers/me/documents ; véhicules, un seul actif. */
export default function OnboardingPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: qk.driverMe, queryFn: driversApi.me });
  const docs = useQuery({ queryKey: qk.documents, queryFn: driversApi.documents });
  const vehicles = useQuery({ queryKey: qk.vehicles, queryFn: driversApi.vehicles });
  const [uploading, setUploading] = useState<DocumentType | null>(null);
  const [expires, setExpires] = useState<Partial<Record<DocumentType, string>>>({});
  const [addOpen, setAddOpen] = useState(false);
  const hasTaxi = (vehicles.data ?? []).some((v) => v.category === 'taxi');

  const latestByType = new Map<DocumentType, DriverDocument>();
  for (const d of [...(docs.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)))
    latestByType.set(d.type, d);

  async function upload(type: DocumentType, file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast(t('driver.onboarding.fileHint'), 'error');
    setUploading(type);
    try {
      const url = await uploadFile(type === 'profile_photo' ? 'profile_photo' : 'document', file);
      const exp = expires[type];
      await driversApi.addDocument({
        type,
        file_url: url,
        ...(exp ? { expires_at: new Date(exp).toISOString() } : {}),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.documents }),
        qc.invalidateQueries({ queryKey: qk.driverMe }),
      ]);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setUploading(null);
    }
  }

  const activate = useMutation({
    mutationFn: (id: string) => driversApi.activateVehicle(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.vehicles });
      void qc.invalidateQueries({ queryKey: qk.driverMe });
    },
  });

  const visibleTypes = DOC_TYPES.filter((d) => d !== 'taxi_card' || hasTaxi || latestByType.has('taxi_card'));
  const approved = visibleTypes.filter(
    (d) => (latestByType.get(d)?.status ?? profile.data?.documents_summary[d]) === 'approved',
  ).length;

  return (
    <MobilePage title={t('driver.onboarding.title')}>
      <p className="text-gray-600 mb-2">{t('driver.onboarding.subtitle')}</p>
      <p className="text-sm font-semibold mb-4">
        {t('driver.onboarding.progress', { done: approved, total: visibleTypes.length })}
      </p>
      <ErrorBox error={docs.error ?? vehicles.error ?? profile.error} />

      <ul className="space-y-3 mb-6">
        {visibleTypes.map((type) => {
          const doc = latestByType.get(type);
          const status = doc?.status ?? profile.data?.documents_summary[type] ?? 'missing';
          const needsExpiry = type === 'license' || type === 'insurance' || type === 'registration';
          return (
            <li key={type} className="card">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">{t(`driver.onboarding.docs.${type}`)}</div>
                <Badge tone={tone[status] ?? 'neutral'}>{t(`driver.onboarding.docStatus.${status}`)}</Badge>
              </div>
              {doc?.status === 'rejected' && doc.review_note && (
                <p className="text-sm text-alert mt-1">
                  {t('driver.onboarding.reviewNote', { note: doc.review_note })}
                </p>
              )}
              {doc?.expires_at && (
                <p className="text-xs text-gray-500 mt-1">
                  {t('driver.onboarding.expiresAt')} : {formatDate(doc.expires_at)}
                </p>
              )}
              {status !== 'approved' && (
                <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-end">
                  {needsExpiry && (
                    <div className="flex-1">
                      <label className="label" htmlFor={`exp-${type}`}>
                        {t('driver.onboarding.expiresAt')}
                      </label>
                      <input
                        id={`exp-${type}`}
                        type="date"
                        className="input"
                        value={expires[type] ?? ''}
                        onChange={(e) => setExpires((s) => ({ ...s, [type]: e.target.value }))}
                      />
                    </div>
                  )}
                  <label className={`btn-primary cursor-pointer ${uploading === type ? 'opacity-60' : ''}`}>
                    {uploading === type
                      ? t('driver.onboarding.uploading')
                      : doc
                        ? t('driver.onboarding.replace')
                        : t('driver.onboarding.upload')}
                    <input
                      type="file"
                      className="sr-only"
                      accept="image/jpeg,image/png,application/pdf"
                      disabled={uploading !== null}
                      onChange={(e) => void upload(type, e.target.files?.[0])}
                    />
                  </label>
                </div>
              )}
              {doc?.file_url && (
                <a
                  href={doc.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-brand-dark underline mt-1 inline-block"
                >
                  {t('admin.drivers.openFile')}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-gray-500 mb-6">{t('driver.onboarding.fileHint')}</p>

      <div className="flex items-center justify-between mb-2">
        <h2 className="font-extrabold text-lg">{t('driver.onboarding.vehicles')}</h2>
        <Button variant="secondary" onClick={() => setAddOpen(true)}>
          {t('driver.onboarding.addVehicle')}
        </Button>
      </div>
      <p className="text-sm text-gray-600 mb-3">{t('driver.onboarding.vehiclesHint')}</p>
      <ul className="space-y-2 mb-6">
        {(vehicles.data ?? []).map((v) => (
          <li key={v.id} className={`card flex items-center gap-3 ${v.is_active ? 'border-brand' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                {v.brand} {v.model} · {v.color}
              </div>
              <div className="text-sm text-gray-600">
                {v.license_plate}
                {v.taxi_number ? ` · N° ${v.taxi_number}` : ''} · {t(`categories.${v.category}`)} · {v.seats}{' '}
                pl.
              </div>
              <div className="flex gap-1 mt-1">
                {v.is_active && <Badge tone="green">{t('driver.onboarding.active')}</Badge>}
                {v.is_verified && <Badge tone="blue">{t('driver.onboarding.verified')}</Badge>}
              </div>
            </div>
            {!v.is_active && (
              <Button variant="secondary" loading={activate.isPending} onClick={() => activate.mutate(v.id)}>
                {t('driver.onboarding.activate')}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <h2 className="font-extrabold text-lg mb-2">{t('driver.profile.title')}</h2>
      <ProfileForm photoRequired />
      <Button variant="ghost" block className="mt-4" onClick={() => nav('/d')}>
        {t('driver.onboarding.goHome')}
      </Button>

      <AddVehicleModal open={addOpen} onClose={() => setAddOpen(false)} />
    </MobilePage>
  );
}

function AddVehicleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    brand: '',
    model: '',
    color: '',
    license_plate: '',
    taxi_number: '',
    category: 'standard' as VehicleCategory,
    seats: 4,
  });
  const create = useMutation({
    mutationFn: () =>
      driversApi.addVehicle({
        brand: form.brand.trim(),
        model: form.model.trim(),
        color: form.color.trim(),
        license_plate: form.license_plate.trim().toUpperCase(),
        taxi_number: form.category === 'taxi' ? form.taxi_number.trim() || null : null,
        category: form.category,
        seats: form.seats,
      } as Omit<Vehicle, 'id' | 'is_verified' | 'is_active'>),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.vehicles });
      onClose();
    },
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: k === 'seats' ? Number(e.target.value) : e.target.value }));
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  return (
    <Modal open={open} onClose={onClose} title={t('driver.onboarding.addVehicle')}>
      <form onSubmit={submit} noValidate>
        <TextField label={t('driver.onboarding.brand')} value={form.brand} onChange={set('brand')} required />
        <TextField label={t('driver.onboarding.model')} value={form.model} onChange={set('model')} required />
        <TextField label={t('driver.onboarding.color')} value={form.color} onChange={set('color')} required />
        <TextField
          label={t('driver.onboarding.plate')}
          value={form.license_plate}
          onChange={set('license_plate')}
          required
        />
        <SelectField label={t('common.category')} value={form.category} onChange={set('category')}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`categories.${c}`)}
            </option>
          ))}
        </SelectField>
        {form.category === 'taxi' && (
          <TextField
            label={t('driver.onboarding.taxiNumber')}
            value={form.taxi_number}
            onChange={set('taxi_number')}
            hint={t('driver.onboarding.taxiOnly')}
          />
        )}
        <TextField
          label={t('driver.onboarding.seats')}
          type="number"
          min={1}
          max={30}
          value={form.seats}
          onChange={set('seats')}
        />
        <ErrorBox error={create.error} />
        <Button
          type="submit"
          block
          loading={create.isPending}
          className="mt-2"
          disabled={!form.brand || !form.model || !form.license_plate}
        >
          {t('common.add')}
        </Button>
      </form>
    </Modal>
  );
}
