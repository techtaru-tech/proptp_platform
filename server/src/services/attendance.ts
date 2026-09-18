import type { AttendanceRecord, GeoFenceResult, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { minutesOfDay, minutesOfDayInOrgZone, parseDayKey } from './dates';

/**
 * Attendance rules, shared by the app's push endpoint and the admin panel's manual edits,
 * so lateness and working hours are computed exactly once in the codebase.
 */

export async function getPolicy() {
  return prisma.attendancePolicySettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
}

/**
 * The geofence a partner must be inside to mark attendance. There is no per-user
 * assignment column yet, so everyone gets the default location; the admin's policy screen
 * edits that same single office, which is how the real system behaves today.
 */
export async function getAssignedLocation() {
  const existing = await prisma.workLocation.findFirst({ where: { isDefault: true } });
  if (existing) return existing;

  const policy = await getPolicy();
  return prisma.workLocation.create({
    data: {
      name: 'ShreeRam Office',
      area: '',
      latitude: policy.officeLat,
      longitude: policy.officeLng,
      radius: policy.geoFenceRadiusMeters,
      isDefault: true,
    },
  });
}

/** Haversine great-circle distance in meters. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export interface MarkInput {
  date?: unknown;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  checkInLocation?: string | null;
  checkOutLocation?: string | null
  checkInLat?: number | null;
  checkInLng?: number | null;
  checkOutLat?: number | null;
  checkOutLng?: number | null;
  isLate?: boolean;
  markedBy?: string | null;
  device?: string | null;
}

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Upsert one day's attendance for a user.
 *
 * The app always sends the day's FULL current state rather than a delta (API docs §2.3),
 * and may retry the same day after being offline, so this is keyed on (userId, date) and
 * is safe to call repeatedly. `isLate` and `workingHours` are always recomputed from the
 * policy — a client-supplied `is_late` is only a hint and is never trusted on its own.
 */
export async function upsertMark(userId: string, input: MarkInput): Promise<AttendanceRecord> {
  const policy = await getPolicy();
  const location = await getAssignedLocation();

  const checkInAt = toDate(input.checkInAt);
  const checkOutAt = toDate(input.checkOutAt);
  const date = parseDayKey(input.date ?? checkInAt ?? checkOutAt ?? new Date());

  const isLate = checkInAt
    ? minutesOfDayInOrgZone(checkInAt) > minutesOfDay(policy.workStartTime) + policy.lateAfterMinutes
    : false;

  const workingHours =
    checkInAt && checkOutAt && checkOutAt > checkInAt
      ? Number(((checkOutAt.getTime() - checkInAt.getTime()) / 3600000).toFixed(2))
      : null;

  const isEarlyDeparture = workingHours !== null && workingHours < policy.standardWorkingHours;

  // The most recent coordinates the client sent decide the geofence verdict; with no
  // coordinates at all it stays `unknown` rather than being guessed as inside.
  const lat = input.checkOutLat ?? input.checkInLat ?? null;
  const lng = input.checkOutLng ?? input.checkInLng ?? null;
  let geoFenceResult: GeoFenceResult = 'unknown';
  let distanceFromOfficeMeters: number | null = null;
  if (typeof lat === 'number' && typeof lng === 'number') {
    distanceFromOfficeMeters = distanceMeters(lat, lng, location.latitude, location.longitude);
    geoFenceResult = distanceFromOfficeMeters <= location.radius ? 'inside' : 'outside';
  }

  const shared: Prisma.AttendanceRecordUncheckedCreateInput = {
    userId,
    date,
    checkInAt,
    checkOutAt,
    checkInLocation: input.checkInLocation ?? null,
    checkOutLocation: input.checkOutLocation ?? null,
    checkInLat: input.checkInLat ?? null,
    checkInLng: input.checkInLng ?? null,
    checkOutLat: input.checkOutLat ?? null,
    checkOutLng: input.checkOutLng ?? null,
    locationId: location.id,
    isLate,
    isEarlyDeparture,
    isAbsent: !checkInAt && !checkOutAt,
    workingHours,
    geoFenceResult,
    distanceFromOfficeMeters,
    syncStatus: 'synced',
    failureReason: null,
    markedBy: input.markedBy ?? null,
    device: input.device ?? null,
  };

  const { userId: _u, date: _d, ...updatable } = shared;
  return prisma.attendanceRecord.upsert({
    where: { userId_date: { userId, date } },
    create: shared,
    update: updatable,
  });
}
