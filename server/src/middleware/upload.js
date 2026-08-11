import multer from 'multer';
import { config } from '../config.js';

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are accepted.'), false);
    }
  },
});
