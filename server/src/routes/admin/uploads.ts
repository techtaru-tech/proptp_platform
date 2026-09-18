import { Router } from 'express';
import { publicUrl, upload } from '../../services/upload';

export const adminUploadsRouter = Router();

/**
 * Generic file upload for the admin panel's image/PDF pickers (project banners, site maps,
 * plot galleries, cheque photos, layout plans). Returns the root-relative URL to store on
 * whichever record the admin is editing.
 */
adminUploadsRouter.post('/', upload.array('files', 20), (req, res) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  if (files.length === 0) return res.status(400).json({ error: 'No files were uploaded.' });
  res.status(201).json({ urls: files.map(publicUrl) });
});
