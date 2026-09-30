import { describe, expect, it } from 'vitest';
import { formatMoney, formatRange, parseAmount } from '@/shared/utils/money';

describe('formatMoney (N-11 : « 12 500 F »)', () => {
  it('groupe les milliers avec une espace insécable et ajoute F', () => {
    expect(formatMoney('12500.00')).toBe('12\u00A0500\u00A0F');
    expect(formatMoney(1500)).toBe('1\u00A0500\u00A0F');
    expect(formatMoney('500')).toBe('500\u00A0F');
    expect(formatMoney('1234567.89')).toBe('1\u00A0234\u00A0568\u00A0F');
  });
  it('gère les négatifs, le signe explicite et les valeurs vides', () => {
    expect(formatMoney('-1800.00')).toBe('-1\u00A0800\u00A0F');
    expect(formatMoney('2000', { sign: true })).toBe('+2\u00A0000\u00A0F');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney('abc')).toBe('—');
  });
  it('formate une fourchette', () => {
    expect(formatRange('1500.00', '1800.00')).toBe('1\u00A0500 – 1\u00A0800\u00A0F');
  });
  it('parse un montant saisi', () => {
    expect(parseAmount('12 500 F')).toBe(12500);
  });
});
