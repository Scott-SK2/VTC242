import { useState, type ReactNode, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { Page } from '@/shared/api/types';
import { Button, Modal, TextAreaField, ErrorBox, Spinner } from '@/shared/ui';

export function AdminPage({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="p-4 lg:p-6 max-w-[1600px]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  tone?: 'neutral' | 'green' | 'red' | 'yellow';
}) {
  const color =
    tone === 'green'
      ? 'text-brand-dark'
      : tone === 'red'
        ? 'text-alert'
        : tone === 'yellow'
          ? 'text-yellow-800'
          : 'text-ink';
  return (
    <div className="card">
      <div className="text-sm text-gray-600">{label}</div>
      <div className={`text-2xl lg:text-3xl font-extrabold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

/** Tableau back-office : défilement horizontal, navigation clavier (flèches + Entrée). */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  error,
  selectedKey,
  onRetry,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  loading?: boolean;
  error?: unknown;
  selectedKey?: string | null;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  function onKey(e: KeyboardEvent<HTMLTableRowElement>, r: T) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick?.(r);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const sib =
        e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
      (sib as HTMLElement | null)?.focus();
    }
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={columns.length} className="text-center py-8 text-brand">
                <Spinner />
              </td>
            </tr>
          )}
          {!loading && error ? (
            <tr>
              <td colSpan={columns.length}>
                <ErrorBox error={error} onRetry={onRetry} />
              </td>
            </tr>
          ) : null}
          {!loading && !error && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="text-center py-8 text-gray-500">
                {t('admin.table.noRows')}
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((r) => {
              const k = rowKey(r);
              return (
                <tr
                  key={k}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={() => onRowClick?.(r)}
                  onKeyDown={(e) => onKey(e, r)}
                  className={`${onRowClick ? 'cursor-pointer hover:bg-gray-50 focus:bg-brand-light outline-none' : ''} ${selectedKey === k ? 'bg-brand-light' : ''}`}
                  aria-selected={selectedKey === k}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.className}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

/** Pagination par curseur (next / previous). */
export function useCursorQuery<T>(
  key: readonly unknown[],
  fetcher: (cursor?: string) => Promise<Page<T>>,
  enabled = true,
) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const q = useQuery({
    queryKey: [...key, cursor ?? ''],
    queryFn: () => fetcher(cursor),
    enabled,
    placeholderData: (prev) => prev,
  });
  const next = () => {
    if (!q.data?.next) return;
    setHistory((h) => [...h, cursor]);
    setCursor(q.data.next);
  };
  const prev = () => {
    setHistory((h) => {
      const copy = [...h];
      const c = copy.pop();
      setCursor(c);
      return copy;
    });
  };
  const reset = () => {
    setCursor(undefined);
    setHistory([]);
  };
  return {
    ...q,
    rows: q.data?.results ?? [],
    next,
    prev,
    reset,
    hasNext: !!q.data?.next,
    hasPrev: history.length > 0,
  };
}

export function Pager({
  hasNext,
  hasPrev,
  onNext,
  onPrev,
}: {
  hasNext: boolean;
  hasPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
}) {
  const { t } = useTranslation();
  if (!hasNext && !hasPrev) return null;
  return (
    <div className="flex justify-end gap-2 mt-3">
      <Button variant="secondary" disabled={!hasPrev} onClick={onPrev} aria-label={t('common.back')}>
        ←
      </Button>
      <Button variant="secondary" disabled={!hasNext} onClick={onNext} aria-label={t('common.next')}>
        →
      </Button>
    </div>
  );
}

/** Modale de confirmation avec motif obligatoire. */
export function ReasonModal({
  open,
  title,
  hint,
  onClose,
  onConfirm,
  loading,
  error,
  danger,
  required = true,
}: {
  open: boolean;
  title: string;
  hint?: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading?: boolean;
  error?: unknown;
  danger?: boolean;
  required?: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={loading}
            disabled={required && reason.trim().length < 3}
            onClick={() => onConfirm(reason.trim())}
          >
            {t('common.confirm')}
          </Button>
        </>
      }
    >
      <TextAreaField
        label={t('common.reason')}
        hint={hint}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('common.reasonPlaceholder')}
      />
      <ErrorBox error={error} />
    </Modal>
  );
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm py-1 border-b border-gray-100 last:border-0">
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold text-right">{children}</span>
    </div>
  );
}
