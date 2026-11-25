import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fr from '@/shared/i18n/fr.json';

/** Toutes les clés littérales t('…') du code doivent exister dans fr.json (sinon l'écran
 *  affiche la clé brute, ex. « profile.nameTitle »). */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|ts)$/.test(f) ? [p] : [];
  });
}

function has(obj: unknown, key: string): boolean {
  let cur: unknown = obj;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else return false;
  }
  return typeof cur === 'string';
}

describe('traductions', () => {
  it('aucune clé utilisée ne manque dans fr.json', () => {
    const missing = new Set<string>();
    for (const file of files(resolve(process.cwd(), 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        const key = m[1] ?? '';
        if (!has(fr, key)) missing.add(`${key}  (${file.split('/src/')[1]})`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
