import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';

/**
 * Local-disk file storage. Files land in server/uploads/ and are served read-only from
 * the /uploads static mount, so a stored value is always a root-relative URL the admin
 * panel and the app can both use directly. Swapping to S3/Cloudinary later means
 * replacing `storage` and `publicUrl` and nothing else.
 */

export const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'video/mp4',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

export function publicUrl(file: Express.Multer.File): string {
  return `/uploads/${file.filename}`;
}

/**
 * Multer's `.fields()` output, flattened to `{ fieldName: url }` for single-file fields.
 * Used by the multipart registration and booking endpoints, which each take a fixed set
 * of one-file-per-field documents.
 */
export function urlsByField(files: unknown): Record<string, string> {
  const grouped = (files ?? {}) as Record<string, Express.Multer.File[]>;
  const out: Record<string, string> = {};
  for (const [field, list] of Object.entries(grouped)) {
    if (list?.[0]) out[field] = publicUrl(list[0]);
  }
  return out;
}
