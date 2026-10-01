import fs from 'fs';
import path from 'path';
import type { NextFunction, Response } from 'express';
import { prisma } from '../prisma';
import type { AuthedRequest } from '../services/auth';
import { publicUrl, upload, UPLOAD_DIR } from '../services/upload';
import { materialFor } from '../services/material';

/**
 * Recording material received at site. One handler, mounted by the app, the staff panel and the
 * vendor portal, so the rules cannot differ by where the entry was typed.
 *
 * Photographs of the material, the challan and the vehicle are mandatory, each stamped with the
 * time and place it was taken. `client_id` makes a retried upload the same entry.
 */
export const materialPhotoFields = upload.fields([
  { name: 'material_photo', maxCount: 3 },
  { name: 'challan_photo', maxCount: 3 },
  { name: 'vehicle_photo', maxCount: 3 },
]);

const KINDS = ['material', 'challan', 'vehicle'] as const;

const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });

export function makeMaterialEntryHandler(opts: { vendorFromLogin: boolean }) {
  return async function postMaterialEntry(req: AuthedRequest, res: Response, next: NextFunction) {
    const byField = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const all = Object.values(byField).flat();
    const cleanup = () => all.forEach((f) => fs.unlink(path.join(UPLOAD_DIR, f.filename), () => undefined));
    const bad = (status: number, code: string, message: string) => {
      cleanup();
      return fail(res, status, code, message);
    };
    try {
      const b = req.body ?? {};
      const clientId = b.client_id ? String(b.client_id) : null;
      if (clientId) {
        const dup = await prisma.materialEntry.findUnique({ where: { clientId } });
        if (dup) {
          cleanup();
          return res.status(200).json({ id: dup.id, status: dup.status, duplicate: true });
        }
      }

      const project = await prisma.project.findUnique({ where: { id: String(b.project_id ?? '') }, select: { id: true } });
      if (!project) return bad(400, 'invalid_project', 'Choose the project the material was received at.');

      let vendorId: string | null = null;
      if (opts.vendorFromLogin) {
        const mine = await prisma.vendor.findUnique({ where: { userId: req.auth!.sub } });
        if (!mine || !mine.active) return bad(403, 'not_a_vendor', 'This login is not linked to an active vendor.');
        vendorId = mine.id;
      } else if (b.vendor_id) {
        const v = await prisma.vendor.findUnique({ where: { id: String(b.vendor_id) } });
        if (!v) return bad(400, 'invalid_vendor', 'That vendor does not exist.');
        vendorId = v.id;
      }

      const name = String(b.material_name ?? '').trim();
      const unit = String(b.unit ?? '').trim();
      const quantity = Number(b.quantity);
      const challanNo = String(b.challan_no ?? '').trim();
      const vehicleNo = String(b.vehicle_no ?? '').trim().toUpperCase();
      const receivedBy = String(b.received_by ?? '').trim();
      const receivedOn = new Date(String(b.received_on ?? ''));
      const expectedOn = b.expected_on ? new Date(String(b.expected_on)) : null;
      if (!name || !unit) return bad(400, 'missing_material', 'Say which material and in what unit.');
      if (!Number.isFinite(quantity) || quantity <= 0) return bad(400, 'invalid_quantity', 'Quantity must be more than zero.');
      if (!challanNo) return bad(400, 'missing_challan', 'The challan or invoice number is required.');
      if (!vehicleNo) return bad(400, 'missing_vehicle', 'The vehicle number is required.');
      if (!receivedBy) return bad(400, 'missing_receiver', 'Say who received it.');
      if (Number.isNaN(receivedOn.getTime()) || receivedOn.getTime() > Date.now() + 86_400_000) return bad(400, 'invalid_date', 'The received date is not valid.');
      if (expectedOn && Number.isNaN(expectedOn.getTime())) return bad(400, 'invalid_date', 'The expected date is not valid.');

      let meta: Record<string, { taken_at?: string; latitude?: number; longitude?: number }[]> = {};
      try { meta = JSON.parse(String(b.photo_meta ?? '{}')); } catch { meta = {}; }
      const photos: { kind: string; url: string; takenAt: Date; latitude: number; longitude: number }[] = [];
      for (const kind of KINDS) {
        const files = byField[`${kind}_photo`] ?? [];
        if (files.length === 0) return bad(400, 'photo_required', `A photo of the ${kind} is required.`);
        const stamps = meta[kind] ?? [];
        if (stamps.length !== files.length) return bad(400, 'photo_meta_missing', `Every ${kind} photo needs its time and location stamp.`);
        for (const [i, f] of files.entries()) {
          const s = stamps[i];
          const takenAt = new Date(String(s.taken_at));
          const latitude = Number(s.latitude);
          const longitude = Number(s.longitude);
          if (Number.isNaN(takenAt.getTime()) || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            return bad(400, 'photo_meta_invalid', `A ${kind} photo has an invalid time or location.`);
          }
          photos.push({ kind, url: publicUrl(f), takenAt, latitude, longitude });
        }
      }

      const material = await materialFor(name, unit);
      const created = await prisma.materialEntry.create({
        data: {
          projectId: project.id, materialId: material.id, vendorId, quantity, challanNo, vehicleNo, receivedBy, receivedOn,
          expectedOn, createdById: req.auth!.sub, clientId, photos: { create: photos },
        },
      });
      res.status(201).json({ id: created.id, status: created.status, duplicate: false });
    } catch (err) {
      cleanup();
      next(err);
    }
  };
}
