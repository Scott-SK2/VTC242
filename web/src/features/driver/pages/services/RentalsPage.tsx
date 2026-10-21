import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { driversApi, rentalsApi } from '@/shared/api/endpoints';
import type { RentalBooking, RentalListing, RentalListingInput } from '@/shared/api/types';
import {
  Badge,
  Button,
  Checkbox,
  Empty,
  ErrorBox,
  MobilePage,
  Modal,
  SelectField,
  Spinner,
  Tabs,
  TextAreaField,
  TextField,
} from '@/shared/ui';
import { formatMoney } from '@/shared/utils/money';
import { toast } from '@/shared/store/ui';
import {
  RentalBookingCard,
  rentalTone,
  useServicesLive,
  type RentalAction,
} from '@/features/services/components';

type Tab = 'requests' | 'listings';

const EMPTY: RentalListingInput = {
  vehicle_id: '',
  title: '',
  description: '',
  city: 'Brazzaville',
  price_per_day_with_driver: '',
  price_per_day_without_driver: '',
  deposit_amount: '0',
  min_days: 1,
  photo_url: '',
  is_active: true,
};

function toInput(l: RentalListing): RentalListingInput {
  return {
    vehicle_id: l.vehicle.id,
    title: l.title,
    description: l.description,
    city: l.city,
    price_per_day_with_driver: l.price_per_day_with_driver ?? '',
    price_per_day_without_driver: l.price_per_day_without_driver ?? '',
    deposit_amount: l.deposit_amount,
    min_days: l.min_days,
    photo_url: l.photo_url ?? '',
    is_active: l.is_active,
  };
}

/** Loueur : annonces (création / modification) et demandes reçues (accepter, refuser, remise des clés, clôture). */
export default function DriverRentalsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  useServicesLive();
  const [tab, setTab] = useState<Tab>('requests');
  const [editing, setEditing] = useState<{ id?: string; form: RentalListingInput } | null>(null);
  const [declining, setDeclining] = useState<{ booking: RentalBooking; action: RentalAction } | null>(null);
  const [reason, setReason] = useState('');
  const vehicles = useQuery({ queryKey: ['driver', 'vehicles'], queryFn: driversApi.vehicles });
  const listings = useQuery({ queryKey: ['rentals', 'my', 'listings'], queryFn: rentalsApi.myListings });
  const bookings = useInfiniteQuery({
    queryKey: ['rentals', 'bookings', 'owner'],
    queryFn: ({ pageParam }) => rentalsApi.bookings({ cursor: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['rentals'] });
    void qc.invalidateQueries({ queryKey: ['wallet'] });
  };
  const save = useMutation({
    mutationFn: ({ id, form }: { id?: string; form: RentalListingInput }) => {
      const body: RentalListingInput = {
        ...form,
        price_per_day_with_driver: form.price_per_day_with_driver || null,
        price_per_day_without_driver: form.price_per_day_without_driver || null,
        photo_url: form.photo_url || null,
        deposit_amount: form.deposit_amount || '0',
      };
      return id ? rentalsApi.patchListing(id, body) : rentalsApi.createListing(body);
    },
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast(t('common.ok'), 'success');
    },
  });
  const act = useMutation({
    mutationFn: ({ booking, action, why }: { booking: RentalBooking; action: RentalAction; why?: string }) =>
      rentalsApi.act(booking.id, action, why ?? ''),
    onSuccess: () => {
      invalidate();
      setDeclining(null);
      setReason('');
      toast(t('common.ok'), 'success');
    },
    onError: (e) => toast(e instanceof Error ? e.message : t('common.error'), 'error'),
  });
  function onAct(booking: RentalBooking, action: RentalAction) {
    if (action === 'decline' || action === 'cancel') setDeclining({ booking, action });
    else act.mutate({ booking, action });
  }
  const items = bookings.data?.pages.flatMap((p) => p.results) ?? [];
  const form = editing?.form;
  const set = (patch: Partial<RentalListingInput>) =>
    editing && setEditing({ ...editing, form: { ...editing.form, ...patch } });
  return (
    <MobilePage
      title={t('services.driverRentals')}
      action={
        <Button onClick={() => setEditing({ form: { ...EMPTY, vehicle_id: vehicles.data?.[0]?.id ?? '' } })}>
          {t('rentals.newListing')}
        </Button>
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-3"
        items={[
          { value: 'requests', label: t('rentals.requests') },
          { value: 'listings', label: t('rentals.myListings') },
        ]}
      />
      {tab === 'requests' &&
        (bookings.isPending ? (
          <div className="py-6 text-center text-brand">
            <Spinner />
          </div>
        ) : bookings.error ? (
          <ErrorBox error={bookings.error} onRetry={() => void bookings.refetch()} />
        ) : items.length === 0 ? (
          <Empty text={t('rentals.noRequests')} />
        ) : (
          <div className="grid gap-3">
            {items.map((b) => (
              <RentalBookingCard
                key={b.id}
                booking={b}
                role="owner"
                busy={act.isPending}
                onAct={(a) => onAct(b, a)}
              />
            ))}
            {bookings.hasNextPage && (
              <Button
                variant="secondary"
                block
                loading={bookings.isFetchingNextPage}
                onClick={() => void bookings.fetchNextPage()}
              >
                {t('common.loadMore')}
              </Button>
            )}
          </div>
        ))}
      {tab === 'listings' &&
        (listings.isPending ? (
          <div className="py-6 text-center text-brand">
            <Spinner />
          </div>
        ) : listings.error ? (
          <ErrorBox error={listings.error} onRetry={() => void listings.refetch()} />
        ) : !listings.data?.length ? (
          <Empty text={t('rentals.noListings')} />
        ) : (
          <div className="grid gap-3">
            {listings.data.map((l) => (
              <div key={l.id} className="rounded-2xl border border-gray-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-extrabold truncate">{l.title}</div>
                    <div className="text-sm text-gray-600">
                      {l.vehicle.brand} {l.vehicle.model} · {l.vehicle.license_plate}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={rentalTone(l.status)}>{t(`rentals.listingStatus.${l.status}`)}</Badge>
                    <Badge tone={l.is_active ? 'neutral' : 'dark'}>
                      {l.is_active ? t('rentals.visible') : t('rentals.hidden')}
                    </Badge>
                  </div>
                </div>
                <div className="text-sm mt-2">
                  {l.price_per_day_with_driver && (
                    <div>
                      {formatMoney(l.price_per_day_with_driver)}/j {t('rentals.withDriver')}
                    </div>
                  )}
                  {l.price_per_day_without_driver && (
                    <div>
                      {formatMoney(l.price_per_day_without_driver)}/j {t('rentals.withoutDriver')} ·{' '}
                      {t('rentals.deposit', { amount: formatMoney(l.deposit_amount) })}
                    </div>
                  )}
                </div>
                {l.status === 'pending' && (
                  <p className="text-xs text-gray-500 mt-1">{t('rentals.pendingHint')}</p>
                )}
                {l.status_reason && <p className="text-xs text-alert mt-1">{l.status_reason}</p>}
                <Button
                  variant="secondary"
                  block
                  className="mt-3"
                  onClick={() => setEditing({ id: l.id, form: toInput(l) })}
                >
                  {t('common.edit')}
                </Button>
              </div>
            ))}
          </div>
        ))}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('rentals.editListing') : t('rentals.newListing')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={save.isPending}
              disabled={!form?.vehicle_id || !form?.title}
              onClick={() => editing && save.mutate({ id: editing.id, form: editing.form })}
            >
              {t('rentals.form.save')}
            </Button>
          </>
        }
      >
        {form && (
          <>
            {vehicles.data && vehicles.data.length === 0 ? (
              <p className="text-sm text-alert mb-2">{t('rentals.form.noVehicle')}</p>
            ) : (
              <SelectField
                label={t('rentals.form.vehicle')}
                value={form.vehicle_id}
                onChange={(e) => set({ vehicle_id: e.target.value })}
              >
                {(vehicles.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.brand} {v.model} · {v.license_plate}
                  </option>
                ))}
              </SelectField>
            )}
            <TextField
              label={t('rentals.form.title')}
              placeholder={t('rentals.form.titlePlaceholder')}
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
            />
            <TextAreaField
              label={t('rentals.form.description')}
              value={form.description ?? ''}
              onChange={(e) => set({ description: e.target.value })}
            />
            <TextField
              label={t('rentals.form.city')}
              value={form.city ?? ''}
              onChange={(e) => set({ city: e.target.value })}
            />
            <TextField
              label={t('rentals.form.priceWith')}
              hint={t('rentals.form.priceHint')}
              type="number"
              inputMode="numeric"
              min={0}
              value={form.price_per_day_with_driver ?? ''}
              onChange={(e) => set({ price_per_day_with_driver: e.target.value })}
            />
            <TextField
              label={t('rentals.form.priceWithout')}
              hint={t('rentals.form.priceHint')}
              type="number"
              inputMode="numeric"
              min={0}
              value={form.price_per_day_without_driver ?? ''}
              onChange={(e) => set({ price_per_day_without_driver: e.target.value })}
            />
            <TextField
              label={t('rentals.form.deposit')}
              hint={t('rentals.form.depositHint')}
              type="number"
              inputMode="numeric"
              min={0}
              value={form.deposit_amount ?? '0'}
              onChange={(e) => set({ deposit_amount: e.target.value })}
            />
            <TextField
              label={t('rentals.form.minDays')}
              type="number"
              min={1}
              max={90}
              value={form.min_days ?? 1}
              onChange={(e) => set({ min_days: Number(e.target.value) || 1 })}
            />
            <TextField
              label={t('rentals.form.photo')}
              type="url"
              value={form.photo_url ?? ''}
              onChange={(e) => set({ photo_url: e.target.value })}
            />
            <Checkbox
              label={t('rentals.form.active')}
              checked={form.is_active ?? true}
              onChange={(e) => set({ is_active: e.target.checked })}
            />
            <ErrorBox error={save.error} />
          </>
        )}
      </Modal>

      <Modal
        open={!!declining}
        onClose={() => setDeclining(null)}
        title={declining?.action === 'decline' ? t('rentals.decline') : t('rentals.cancel')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeclining(null)}>
              {t('common.back')}
            </Button>
            <Button
              variant="danger"
              loading={act.isPending}
              onClick={() => declining && act.mutate({ ...declining, why: reason })}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <TextAreaField
          label={t('rentals.declineReason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <ErrorBox error={act.error} />
      </Modal>
    </MobilePage>
  );
}
