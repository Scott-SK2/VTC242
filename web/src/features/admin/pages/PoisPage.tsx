import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, asList } from '@/shared/api/endpoints';
import type { Poi } from '@/shared/api/types';
import { MapView, type MapMarker } from '@/shared/map';
import { AdminPage, DataTable, type Column } from '../components';
import { Button, ErrorBox, SelectField, TextField } from '@/shared/ui';
import { BRAZZAVILLE } from '@/shared/utils/geo';
import { toast } from '@/shared/store/ui';

type Draft = Omit<Poi, 'id'> & { id?: string };

/** Points d'intérêt locaux (F-57) : ajout, alias, position par clic sur la carte. */
export default function PoisPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const pois = useQuery({ queryKey: ['admin', 'pois'], queryFn: () => adminApi.pois(), select: asList });
  const zones = useQuery({ queryKey: ['admin', 'zones'], queryFn: adminApi.zones, select: asList });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [aliases, setAliases] = useState('');
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin', 'pois'] });
  const save = useMutation({
    mutationFn: () => {
      const { id, ...body } = draft as Draft;
      const payload = {
        ...body,
        aliases: aliases
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      return id ? adminApi.patchPoi(id, payload) : adminApi.createPoi(payload);
    },
    onSuccess: () => {
      invalidate();
      setDraft(null);
      toast(t('admin.pois.saved'), 'success');
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => adminApi.deletePoi(id),
    onSuccess: () => {
      invalidate();
      setDraft(null);
    },
  });
  const edit = useCallback((p: Poi) => {
    setDraft(p);
    setAliases(p.aliases.join(', '));
  }, []);
  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = (pois.data ?? []).map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      kind: 'poi',
      label: p.name,
      onClick: () => edit(p),
    }));
    if (draft)
      list.push({ id: 'draft', lat: draft.lat, lng: draft.lng, kind: 'pickup', label: draft.name || '…' });
    return list;
  }, [pois.data, draft, edit]);
  function create() {
    setDraft({
      name: '',
      aliases: [],
      lat: BRAZZAVILLE.lat,
      lng: BRAZZAVILLE.lng,
      zone_id: zones.data?.[0]?.id ?? '',
    });
    setAliases('');
  }
  const columns: Column<Poi>[] = [
    { key: 'name', header: t('common.name'), render: (p) => <span className="font-semibold">{p.name}</span> },
    { key: 'aliases', header: t('admin.pois.aliases'), render: (p) => p.aliases.join(', ') },
    {
      key: 'pos',
      header: t('admin.pois.position'),
      render: (p) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
    },
    {
      key: 'zone',
      header: t('common.zone'),
      render: (p) => zones.data?.find((z) => z.id === p.zone_id)?.name ?? p.zone_id.slice(0, 8),
    },
  ];
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <AdminPage
      title={t('admin.pois.title')}
      actions={<Button onClick={create}>{t('admin.pois.new')}</Button>}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="h-[40vh] min-h-[300px] rounded-2xl overflow-hidden border border-gray-200 relative">
            <MapView
              center={draft ? { lat: draft.lat, lng: draft.lng } : BRAZZAVILLE}
              zoom={12}
              markers={markers}
              onClick={draft ? (p) => setDraft((d) => (d ? { ...d, ...p } : d)) : undefined}
            />
            {draft && (
              <p className="absolute bottom-2 left-2 bg-white/90 rounded-lg px-3 py-1 text-xs">
                {t('admin.pois.pickOnMap')}
              </p>
            )}
          </div>
          <DataTable
            columns={columns}
            rows={pois.data ?? []}
            rowKey={(p) => p.id}
            onRowClick={edit}
            loading={pois.isPending}
            error={pois.error}
            onRetry={() => void pois.refetch()}
          />
        </div>
        <aside className="card h-fit">
          {draft ? (
            <form onSubmit={submit} noValidate>
              <TextField
                label={t('common.name')}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
              <TextField
                label={t('admin.pois.aliases')}
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-x-3">
                <TextField
                  label="Lat"
                  inputMode="decimal"
                  value={draft.lat}
                  onChange={(e) => setDraft({ ...draft, lat: Number(e.target.value) })}
                />
                <TextField
                  label="Lng"
                  inputMode="decimal"
                  value={draft.lng}
                  onChange={(e) => setDraft({ ...draft, lng: Number(e.target.value) })}
                />
              </div>
              <SelectField
                label={t('common.zone')}
                value={draft.zone_id}
                onChange={(e) => setDraft({ ...draft, zone_id: e.target.value })}
              >
                {(zones.data ?? []).map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </SelectField>
              <ErrorBox error={save.error ?? del.error} />
              <div className="flex flex-wrap gap-2 justify-end mt-2">
                {draft.id && (
                  <Button
                    variant="danger"
                    loading={del.isPending}
                    onClick={() =>
                      draft.id && window.confirm(t('common.delete') + ' ?') && del.mutate(draft.id)
                    }
                  >
                    {t('common.delete')}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setDraft(null)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" loading={save.isPending} disabled={!draft.name}>
                  {t('common.save')}
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-gray-500">{t('admin.drivers.noSelection')}</p>
          )}
        </aside>
      </div>
    </AdminPage>
  );
}
