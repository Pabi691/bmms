import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const SCREENSHOT_DIR = path.join(UPLOAD_ROOT, 'payment-screenshots');
const QR_DIR = path.join(UPLOAD_ROOT, 'building-qr');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(QR_DIR, { recursive: true });

const ALLOWED_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf',
};
const IMAGE_ONLY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};

function makeUploader(dir, allowed) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      // randomized name — never trust/reuse the client-supplied filename (path traversal, collisions)
      const ext = allowed[file.mimetype] || '';
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  });
  const fileFilter = (req, file, cb) => {
    if (!allowed[file.mimetype]) {
      return cb(Object.assign(new Error('Unsupported file type'), { status: 400 }));
    }
    cb(null, true);
  };
  return multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
}

export const uploadPaymentScreenshot = makeUploader(SCREENSHOT_DIR, ALLOWED_MIME).single('screenshot');
export const uploadBuildingQr = makeUploader(QR_DIR, IMAGE_ONLY_MIME).single('qr');

const MAGIC = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

// Declared Content-Type can be spoofed by the client — this reads the real
// file header and confirms it matches, deleting the file and throwing if not.
export function sniffAndValidate(filePath, declaredMime) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);

  let ok = false;
  if (declaredMime === 'image/webp') {
    ok = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  } else {
    const match = MAGIC.find((m) => m.mime === declaredMime);
    ok = !!match && match.bytes.every((b, i) => buf[i] === b);
  }
  if (!ok) {
    fs.unlinkSync(filePath);
    throw Object.assign(new Error('File content does not match its declared type'), { status: 400 });
  }
}

export const SCREENSHOT_DIR_ABS = SCREENSHOT_DIR;
export const QR_DIR_ABS = QR_DIR;
