import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { geoApi } from '@/shared/api/endpoints';
import type { AutocompleteResult, LatLng, Place } from '@/shared/api/types';

/** Recherche d'adresse : autocomplétion /geo/autocomplete (POI + Photon) + saisie libre (F-11). */
export function AddressSearch({
  label,
  initial = '',
  near,
  onSelect,
  onPickOnMap,
  autoFocus,
}: {
  label: string;
  initial?: string;
  near?: LatLng | null;
  onSelect: (place: Place | { address: string; lat?: undefined; lng?: undefined }) => void;
  onPickOnMap?: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<AutocompleteResult[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      geoApi
        .autocomplete(term, near ?? undefined, ctrl.signal)
        .then((r) => setResults(r.results ?? []))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(id);
  }, [q, near]);

  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        placeholder={t('passenger.search.placeholder')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-autocomplete="list"
        aria-busy={loading}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && q.trim()) {
            e.preventDefault();
            const first = results[0];
            if (first) onSelect({ address: first.label, lat: first.lat, lng: first.lng });
            else onSelect({ address: q.trim() });
          }
        }}
      />
      <p className="mt-1 text-xs text-gray-500">{t('passenger.search.hint')}</p>
      <ul className="mt-2 divide-y divide-gray-100 max-h-64 overflow-y-auto" role="listbox">
        {results.map((r, i) => (
          <li key={`${r.lat}-${r.lng}-${i}`}>
            <button
              type="button"
              role="option"
              aria-selected={false}
              className="w-full text-left py-3 min-h-tap flex items-start gap-3"
              onClick={() => onSelect({ address: r.label, lat: r.lat, lng: r.lng })}
            >
              <span className="mt-0.5 text-brand" aria-hidden="true">
                {r.source === 'poi' ? '★' : '📍'}
              </span>
              <span>
                <span className="block font-semibold">{r.label}</span>
                <span className="block text-sm text-gray-500">
                  {r.secondary}
                  {r.source === 'poi' ? ` · ${t('passenger.search.poi')}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
        {q.trim().length >= 2 && (
          <li>
            <button
              type="button"
              className="w-full text-left py-3 min-h-tap text-brand-dark font-semibold"
              onClick={() => onSelect({ address: q.trim() })}
            >
              {t('passenger.search.free', { q: q.trim() })}
            </button>
          </li>
        )}
        {onPickOnMap && (
          <li>
            <button
              type="button"
              className="w-full text-left py-3 min-h-tap font-semibold"
              onClick={onPickOnMap}
            >
              🗺 {t('passenger.search.setOnMap')}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
