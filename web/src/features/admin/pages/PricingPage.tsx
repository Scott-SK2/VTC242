import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, asList } from '@/shared/api/endpoints';
import type { AdminZone, PricingRule, PricingRuleInput, VehicleCategory } from '@/shared/api/types';
import { AdminPage, DataTable, type Column } from '../components';
import { Badge, Button, Checkbox, ErrorBox, Modal, SelectField, TextField, Money } from '@/shared/ui';
import { formatDateTime } from '@/shared/utils/date';
import { formatMoney } from '@/shared/utils/money';
import { useAuthStore } from '@/shared/store/auth';

const CATEGORIES: VehicleCategory[] = ['taxi', 'standard', 'vip', 'wedding', 'moving'];
const NUMERIC: Array<keyof PricingRuleInput> = [
  'base_fare',
  'per_km',
  'per_minute',
  'minimum_fare',
  'waiting_per_minute',
  'cancellation_fee',
  'driver_cancellation_share',
  'commission_rate',
  'surge_multiplier',
];

function ruleState(r: PricingRule): 'current' | 'future' | 'past' {
  const now = Date.now();
  if (new Date(r.effective_from).getTime() > now) return 'future';
  if (r.effective_to && new Date(r.effective_to).getTime() < now) return 'past';
  return 'current';
}

const empty = (zone_id: string): PricingRuleInput => ({
  zone_id,
  category: 'taxi',
  base_fare: '500.00',
  per_km: '150.00',
  per_minute: '25.00',
  minimum_fare: '1000.00',
  free_waiting_seconds: 180,
  waiting_per_minute: '50.00',
  cancellation_fee: '500.00',
  driver_cancellation_share: '0.50',
  commission_rate: '0.15',
  surge_multiplier: '1.00',
  cash_enabled: true,
  effective_from: new Date().toISOString(),
  effective_to: null,
});

/** Grille tarifaire versionnée (F-55) + simulateur. */
export default function PricingPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'admin' || role === 'finance';
  const rules = useQuery({
    queryKey: ['admin', 'pricing'],
    queryFn: () => adminApi.pricingRules(),
    select: asList,
  });
  const zones = useQuery({ queryKey: ['admin', 'zones'], queryFn: adminApi.zones, select: asList });
  const [editing, setEditing] = useState<PricingRule | PricingRuleInput | null>(null);
  const zoneName = (id: string) => zones.data?.find((z) => z.id === id)?.name ?? id.slice(0, 8);
  const columns: Column<PricingRule>[] = [
    { key: 'zone', header: t('common.zone'), render: (r) => zoneName(r.zone_id) },
    { key: 'cat', header: t('common.category'), render: (r) => t(`categories.${r.category}`) },
    {
      key: 'state',
      header: t('common.status'),
      render: (r) => {
        const s = ruleState(r);
        return (
          <Badge tone={s === 'current' ? 'green' : s === 'future' ? 'yellow' : 'neutral'}>
            {t(`admin.pricing.${s}`)}
          </Badge>
        );
      },
    },
    { key: 'base', header: t('admin.pricing.base_fare'), render: (r) => <Money value={r.base_fare} /> },
    { key: 'km', header: t('admin.pricing.per_km'), render: (r) => <Money value={r.per_km} /> },
    { key: 'min', header: t('admin.pricing.per_minute'), render: (r) => <Money value={r.per_minute} /> },
    {
      key: 'minimum',
      header: t('admin.pricing.minimum_fare'),
      render: (r) => <Money value={r.minimum_fare} />,
    },
    {
      key: 'wait',
      header: t('admin.pricing.free_waiting_seconds'),
      render: (r) => `${r.free_waiting_seconds} s · ${formatMoney(r.waiting_per_minute)}/min`,
    },
    {
      key: 'cancel',
      header: t('admin.pricing.cancellation_fee'),
      render: (r) => <Money value={r.cancellation_fee} />,
    },
    {
      key: 'commission',
      header: t('admin.pricing.commission_rate'),
      render: (r) => `${(Number(r.commission_rate) * 100).toFixed(0)} %`,
    },
    { key: 'surge', header: t('admin.pricing.surge_multiplier'), render: (r) => `× ${r.surge_multiplier}` },
    {
      key: 'cash',
      header: t('admin.pricing.cash_enabled'),
      render: (r) => (r.cash_enabled ? t('common.yes') : t('common.no')),
    },
    {
      key: 'from',
      header: t('admin.pricing.effective_from'),
      render: (r) => formatDateTime(r.effective_from),
    },
    { key: 'to', header: t('admin.pricing.effective_to'), render: (r) => formatDateTime(r.effective_to) },
  ];
  return (
    <AdminPage
      title={t('admin.pricing.title')}
      actions={
        canEdit && (
          <Button onClick={() => setEditing(empty(zones.data?.[0]?.id ?? ''))}>
            {t('admin.pricing.newRule')}
          </Button>
        )
      }
    >
      <p className="text-sm text-gray-600 mb-3">{t('admin.pricing.versioned')}</p>
      <DataTable
        columns={columns}
        rows={rules.data ?? []}
        rowKey={(r) => r.id}
        onRowClick={canEdit ? setEditing : undefined}
        loading={rules.isPending}
        error={rules.error}
        onRetry={() => void rules.refetch()}
      />
      <Simulator zones={zones.data ?? []} />
      {editing && (
        <RuleModal
          rule={editing}
          zones={zones.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ['admin', 'pricing'] });
          }}
        />
      )}
    </AdminPage>
  );
}

function RuleModal({
  rule,
  zones,
  onClose,
  onSaved,
}: {
  rule: PricingRule | PricingRuleInput;
  zones: AdminZone[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = 'id' in rule;
  const [form, setForm] = useState<PricingRuleInput>(() => {
    const { id: _id, ...rest } = rule as PricingRule;
    return rest;
  });
  const save = useMutation({
    mutationFn: () =>
      isEdit ? adminApi.patchPricingRule((rule as PricingRule).id, form) : adminApi.createPricingRule(form),
    onSuccess: onSaved,
  });
  const set = <K extends keyof PricingRuleInput>(k: K, v: PricingRuleInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const toLocal = (iso: string | null) =>
    iso
      ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : '';
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Modal open onClose={onClose} title={isEdit ? t('admin.pricing.editRule') : t('admin.pricing.newRule')}>
      <form onSubmit={submit} noValidate>
        <div className="grid sm:grid-cols-2 gap-x-3">
          <SelectField
            label={t('common.zone')}
            value={form.zone_id}
            onChange={(e) => set('zone_id', e.target.value)}
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('common.category')}
            value={form.category}
            onChange={(e) => set('category', e.target.value as VehicleCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </SelectField>
          {NUMERIC.map((k) => (
            <TextField
              key={k}
              label={t(`admin.pricing.${k}`)}
              inputMode="decimal"
              value={String(form[k] ?? '')}
              onChange={(e) => set(k, e.target.value as never)}
            />
          ))}
          <TextField
            label={t('admin.pricing.free_waiting_seconds')}
            type="number"
            value={form.free_waiting_seconds}
            onChange={(e) => set('free_waiting_seconds', Number(e.target.value))}
          />
          <TextField
            label={t('admin.pricing.effective_from')}
            type="datetime-local"
            value={toLocal(form.effective_from)}
            onChange={(e) => set('effective_from', new Date(e.target.value).toISOString())}
          />
          <TextField
            label={t('admin.pricing.effective_to')}
            type="datetime-local"
            value={toLocal(form.effective_to)}
            onChange={(e) =>
              set('effective_to', e.target.value ? new Date(e.target.value).toISOString() : null)
            }
          />
        </div>
        <Checkbox
          label={t('admin.pricing.cash_enabled')}
          checked={form.cash_enabled}
          onChange={(e) => set('cash_enabled', e.target.checked)}
        />
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Simulator({ zones }: { zones: AdminZone[] }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    zone_id: '',
    category: 'taxi' as VehicleCategory,
    distance_m: 5000,
    duration_s: 900,
    waiting_seconds: 0,
    at: '',
  });
  const sim = useMutation({
    mutationFn: () =>
      adminApi.simulate({
        ...form,
        zone_id: form.zone_id || zones[0]?.id || '',
        at: form.at ? new Date(form.at).toISOString() : undefined,
      }),
  });
  return (
    <section className="card mt-6">
      <h2 className="font-extrabold text-lg mb-2">{t('admin.pricing.simulator')}</h2>
      <form
        className="grid sm:grid-cols-3 lg:grid-cols-6 gap-x-3"
        onSubmit={(e) => {
          e.preventDefault();
          sim.mutate();
        }}
      >
        <SelectField
          label={t('common.zone')}
          value={form.zone_id || zones[0]?.id || ''}
          onChange={(e) => setForm((f) => ({ ...f, zone_id: e.target.value }))}
        >
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('common.category')}
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as VehicleCategory }))}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`categories.${c}`)}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t('admin.pricing.distance_m')}
          type="number"
          value={form.distance_m}
          onChange={(e) => setForm((f) => ({ ...f, distance_m: Number(e.target.value) }))}
        />
        <TextField
          label={t('admin.pricing.duration_s')}
          type="number"
          value={form.duration_s}
          onChange={(e) => setForm((f) => ({ ...f, duration_s: Number(e.target.value) }))}
        />
        <TextField
          label={t('admin.pricing.waiting_seconds')}
          type="number"
          value={form.waiting_seconds}
          onChange={(e) => setForm((f) => ({ ...f, waiting_seconds: Number(e.target.value) }))}
        />
        <TextField
          label={t('admin.pricing.at')}
          type="datetime-local"
          value={form.at}
          onChange={(e) => setForm((f) => ({ ...f, at: e.target.value }))}
        />
        <div className="sm:col-span-3 lg:col-span-6">
          <Button type="submit" variant="dark" loading={sim.isPending}>
            {t('admin.pricing.simulate')}
          </Button>
        </div>
      </form>
      <ErrorBox error={sim.error} />
      {sim.data && (
        <div className="mt-3 flex flex-wrap gap-6 items-start">
          <div>
            <div className="text-sm text-gray-600">{t('admin.pricing.result')}</div>
            <div className="text-3xl font-extrabold">
              <Money value={sim.data.price} />
            </div>
          </div>
          <div className="text-sm">
            <div className="text-gray-600 mb-1">{t('admin.pricing.breakdown')}</div>
            <ul>
              {Object.entries(sim.data.breakdown ?? {}).map(([k, v]) => (
                <li key={k}>
                  <span className="text-gray-600">{k}</span> : {String(v)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
