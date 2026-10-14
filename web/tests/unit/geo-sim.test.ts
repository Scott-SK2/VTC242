import { beforeEach, describe, expect, it } from 'vitest';
import { useGeoSimStore } from '@/shared/store/geoSim';
import { getCurrentPosition, simulatedFix } from '@/shared/utils/geolocation';

describe('position simulée (mode test)', () => {
  beforeEach(() => {
    localStorage.clear();
    useGeoSimStore.getState().disable();
  });

  it('est désactivée par défaut et centrée sur Brazzaville', () => {
    const s = useGeoSimStore.getState();
    expect(s.enabled).toBe(false);
    expect(s.position.lat).toBeCloseTo(-4.26, 1);
  });

  it('remplace le GPS quand elle est activée et se déplace', async () => {
    useGeoSimStore.getState().enable({ lat: -4.265, lng: 15.28 });
    const fix = await getCurrentPosition(10);
    expect(fix.lat).toBe(-4.265);
    expect(fix.accuracy_m).toBe(5);
    useGeoSimStore.getState().move({ lat: -4.25, lng: 15.25 });
    expect(useGeoSimStore.getState().position.lng).toBe(15.25);
    expect(simulatedFix(useGeoSimStore.getState().position).lat).toBe(-4.25);
  });

  it('persiste le réglage dans le navigateur', () => {
    useGeoSimStore.getState().enable({ lat: -4.3, lng: 15.3 });
    const raw = JSON.parse(localStorage.getItem('vtc242.geoSim') ?? '{}');
    expect(raw.enabled).toBe(true);
    expect(raw.position.lat).toBe(-4.3);
  });
});
