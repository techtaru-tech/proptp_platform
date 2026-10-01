import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../prisma';
import { UPLOAD_DIR, publicUrl } from '../services/upload';
import { cameraForKey } from '../services/cameras';

/**
 * Where a camera's PC pushes its pictures: POST /api/camera-ingest.
 *
 * Public by necessity — the caller is a script, not a signed-in person — so it is held to a
 * single power: add pictures to the one camera the key belongs to. Images only, a bounded number
 * per request, and a picture sent twice is stored once.
 */
export const cameraIngestRouter = Router();

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, UPLOAD_DIR),
    filename: (_r, f, cb) => cb(null, `cam-${Date.now()}-${crypto.randomBytes(5).toString('hex')}${path.extname(f.originalname).toLowerCase().slice(0, 6) || '.jpg'}`),
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 20 },
  fileFilter: (_r, f, cb) => cb(null, ALLOWED.has(f.mimetype)),
});

const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

cameraIngestRouter.post('/', upload.array('images', 20), async (req, res, next) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  const drop = (f: Express.Multer.File) => fs.unlink(path.join(UPLOAD_DIR, f.filename), () => undefined);
  try {
    const camera = await cameraForKey(String(req.header('x-camera-key') ?? ''));
    if (!camera) {
      files.forEach(drop);
      // The same answer for a wrong key and a switched-off camera.
      return res.status(401).json({ error: 'Unknown or inactive camera key.' });
    }
    // Contact counts as "seen" even when there is nothing new, which is how a camera that is up
    // but quiet differs from one that is down.
    await prisma.camera.update({ where: { id: camera.id }, data: { lastSeenAt: new Date() } });
    if (files.length === 0) return res.json({ stored: 0, duplicates: 0, rejected: 0, note: 'No images in the request.' });

    // captured_at repeats once per image, in the same order as the images.
    const raw = req.body?.captured_at;
    const stamps: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    let stored = 0;
    let duplicates = 0;
    let latest: Date | null = null;
    for (const [i, f] of files.entries()) {
      const full = path.join(UPLOAD_DIR, f.filename);
      const hash = sha256(full);
      const parsed = stamps[i] ? new Date(stamps[i]) : null;
      const now = Date.now();
      // A usable time, not one from the future (a PC with a wrong clock); otherwise when it arrived.
      const capturedAt = parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() <= now + 5 * 60_000 ? parsed : new Date();
      try {
        await prisma.cameraImage.create({ data: { cameraId: camera.id, url: publicUrl(f), capturedAt, fileHash: hash, sizeBytes: f.size } });
        stored += 1;
        if (!latest || capturedAt > latest) latest = capturedAt;
      } catch {
        // The unique (camera, hash) key: this exact picture is already here.
        duplicates += 1;
        drop(f);
      }
    }
    if (latest && (!camera.lastImageAt || latest > camera.lastImageAt)) {
      await prisma.camera.update({ where: { id: camera.id }, data: { lastImageAt: latest } });
    }
    res.status(201).json({ stored, duplicates, rejected: Math.max(0, (req.body?.count ? Number(req.body.count) : files.length) - files.length) });
  } catch (err) {
    files.forEach(drop);
    next(err);
  }
});
