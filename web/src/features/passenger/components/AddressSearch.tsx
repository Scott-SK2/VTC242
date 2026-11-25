import { useEffect, useId, useRef, useState } from 'react';
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
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputId = useId();
  // Position lue au moment de la requête : chaque nouveau point GPS ne doit pas relancer la
  // recherche (la liste changeait sous le doigt au moment de toucher une suggestion)
  const nearRef = useRef(near);
  nearRef.current = near;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      // champ vidé : la requête en cours ne doit pas ramener d'anciens résultats
      abortRef.current?.abort();
      abortRef.current = null;
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    const id = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setFailed(false);
      geoApi
        .autocomplete(term, nearRef.current ?? undefined, ctrl.signal)
        .then((r) => {
          if (!ctrl.signal.aborted) setResults(r.results ?? []);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div>
      <label className="label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
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
      {failed && (
        <p className="mt-1 text-xs text-alert" role="status">
          {t('passenger.search.failed')}
        </p>
      )}
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
