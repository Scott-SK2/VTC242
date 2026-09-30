import Dexie, { type EntityTable } from 'dexie';
import type { DriverPosition } from '@/shared/api/types';
import { driversApi } from '@/shared/api/endpoints';

/** File hors ligne (F-41) : positions mises en attente dans IndexedDB puis rejouées via POST /drivers/me/location. */
export interface QueuedPosition extends DriverPosition {
  id?: number;
}

class VtcDb extends Dexie {
  positions!: EntityTable<QueuedPosition, 'id'>;
  constructor() {
    super('vtc242-driver');
    this.version(1).stores({ positions: '++id, recorded_at' });
  }
}

export const db = new VtcDb();

const MAX_QUEUE = 2000;
const BATCH = 200;
let flushing = false;

export async function enqueuePosition(p: DriverPosition): Promise<void> {
  try {
    await db.positions.add({ ...p });
    const count = await db.positions.count();
    if (count > MAX_QUEUE) {
      const oldest = await db.positions
        .orderBy('id')
        .limit(count - MAX_QUEUE)
        .primaryKeys();
      await db.positions.bulkDelete(oldest);
    }
  } catch (e) {
    console.warn('queue', e);
  }
}

export async function queuedCount(): Promise<number> {
  try {
    return await db.positions.count();
  } catch {
    return 0;
  }
}

/** Rejoue la file par lots ; renvoie le nombre de positions acceptées. */
export async function flushQueue(): Promise<number> {
  if (flushing || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0;
  flushing = true;
  let total = 0;
  try {
    for (;;) {
      const batch = await db.positions.orderBy('id').limit(BATCH).toArray();
      if (!batch.length) break;
      const positions = batch.map(({ id: _id, ...rest }) => rest);
      await driversApi.sendPositions(positions);
      await db.positions.bulkDelete(batch.map((b) => b.id as number));
      total += batch.length;
    }
  } catch (e) {
    console.warn('flush', e);
  } finally {
    flushing = false;
  }
  return total;
}
