/** Normalise un numéro congolais : "06 123 45 67" → "+242061234567". */
export function normalizePhone(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00242')) digits = digits.slice(5);
  else if (digits.startsWith('242') && digits.length === 12) digits = digits.slice(3);
  // Au Congo, le 0 initial fait partie du numéro (+242 06 123 45 67) : on le garde.
  return `+242${digits}`;
}

export function isValidCongoPhone(input: string): boolean {
  return /^\+242\d{9}$/.test(normalizePhone(input));
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  return phone.replace(/(\+242\d{2})\d{4}(\d{3})/, '$1 •••• $2');
}
