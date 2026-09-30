/** Normalise un numéro congolais : "06 123 45 67" → "+242061234567". */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+242')) return `+242${digits.slice(4).replace(/\D/g, '')}`;
  if (digits.startsWith('242')) return `+${digits}`;
  if (digits.startsWith('00242')) return `+${digits.slice(2)}`;
  return `+242${digits.replace(/^0+/, '').replace(/\D/g, '')}`;
}

export function isValidCongoPhone(input: string): boolean {
  return /^\+242\d{9}$/.test(normalizePhone(input));
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  return phone.replace(/(\+242\d{2})\d{4}(\d{3})/, '$1 •••• $2');
}
