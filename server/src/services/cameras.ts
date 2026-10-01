import crypto from 'crypto';
import { prisma } from '../prisma';

/**
 * Cameras: their keys and their derived health.
 *
 * A camera's PC pushes pictures with a key. Only the key's hash is stored, so a leaked database
 * does not leak working keys; the key is shown once, when it is made or rotated. Whether a camera
 * is live, stale or offline comes from when it last delivered against how often it should.
 */

export function newKey(): { key: string; hash: string; prefix: string } {
  const key = `rck_${crypto.randomBytes(24).toString('hex')}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, 8) };
}
export const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

export async function cameraForKey(key: string | undefined) {
  if (!key || !key.startsWith('rck_')) return null;
  const cam = await prisma.camera.findUnique({ where: { keyHash: hashKey(key) } });
  return cam && cam.active ? cam : null;
}

export type Health = 'live' | 'stale' | 'offline' | 'never' | 'off';

/** Live within one expected interval (plus grace), stale within three, offline beyond that. */
export function healthOf(c: { active: boolean; lastImageAt: Date | null; expectedEveryMinutes: number }, at = new Date()): { health: Health; silentMinutes: number | null } {
  if (!c.active) return { health: 'off', silentMinutes: null };
  if (!c.lastImageAt) return { health: 'never', silentMinutes: null };
  const silent = Math.floor((at.getTime() - c.lastImageAt.getTime()) / 60_000);
  const every = Math.max(1, c.expectedEveryMinutes);
  const health: Health = silent <= every * 1.5 ? 'live' : silent <= every * 3 ? 'stale' : 'offline';
  return { health, silentMinutes: silent };
}
