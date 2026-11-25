import { describe, expect, it } from 'vitest';
import { isValidCongoPhone, normalizePhone } from '@/shared/utils/phone';

describe('numéros congolais', () => {
  it('accepte le numéro tel qu’on l’écrit au Congo, 0 initial compris', () => {
    expect(normalizePhone('06 123 45 67')).toBe('+242061234567');
    expect(isValidCongoPhone('06 123 45 67')).toBe(true);
    expect(isValidCongoPhone('05.512.34.56')).toBe(true);
  });

  it('accepte les formes internationales', () => {
    for (const v of ['+242061234567', '+242 06 123 45 67', '242061234567', '00242061234567'])
      expect(normalizePhone(v)).toBe('+242061234567');
  });

  it('refuse un numéro trop court ou trop long', () => {
    expect(isValidCongoPhone('6123456')).toBe(false);
    expect(isValidCongoPhone('06 123 45 678')).toBe(false);
    expect(isValidCongoPhone('')).toBe(false);
  });
});
