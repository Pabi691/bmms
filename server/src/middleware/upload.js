import multer from 'multer';
import crypto from 'crypto';
import { put } from '@vercel/blob';

const ALLOWED_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf',
};
const IMAGE_ONLY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};

// In-memory storage: Vercel functions have no persistent disk, so the file
// lives only as a buffer for the length of the request, then goes straight
// to Vercel Blob (see putUpload below) instead of a local path.
function makeUploader(allowed) {
  const fileFilter = (req, file, cb) => {
    if (!allowed[file.mimetype]) {
      return cb(Object.assign(new Error('Unsupported file type'), { status: 400 }));
    }
    cb(null, true);
  };
  return multer({ storage: multer.memoryStorage(), fileFilter, limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
}

export const uploadPaymentScreenshot = makeUploader(ALLOWED_MIME).single('screenshot');
export const uploadBuildingQr = makeUploader(IMAGE_ONLY_MIME).single('qr');

const MAGIC = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

// Declared Content-Type can be spoofed by the client — this reads the real
// file header from the in-memory buffer and confirms it matches.
export function sniffAndValidate(buffer, declaredMime) {
  let ok = false;
  if (declaredMime === 'image/webp') {
    ok = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  } else {
    const match = MAGIC.find((m) => m.mime === declaredMime);
    ok = !!match && match.bytes.every((b, i) => buffer[i] === b);
  }
  if (!ok) {
    throw Object.assign(new Error('File content does not match its declared type'), { status: 400 });
  }
}

// Uploads to Vercel Blob under a randomized name (never the client-supplied
// filename — path traversal, collisions) and returns the blob's URL. That
// URL is what gets stored in the DB column that used to hold a local
// filename (screenshot_path / bank_qr_path). Vercel Blob only supports
// `access: 'public'` — the URL itself is unguessable, and the two serving
// routes below never hand it to the client directly; they always check
// auth first and proxy the bytes through streamBlob.
export async function putUpload(file, folder) {
  const ext = ALLOWED_MIME[file.mimetype] || '';
  const name = `${folder}/${crypto.randomBytes(16).toString('hex')}${ext}`;
  const blob = await put(name, file.buffer, {
    access: 'public',
    contentType: file.mimetype,
    addRandomSuffix: false,
  });
  return blob.url;
}

// Streams a previously-uploaded blob back through our own server so the
// caller's auth check (never express.static, never a raw redirect to the
// blob URL) still gates access.
export async function streamBlob(url, res) {
  const r = await fetch(url);
  if (!r.ok || !r.body) {
    if (!res.headersSent) res.status(404).json({ error: 'File not found' });
    return;
  }
  res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
  for await (const chunk of r.body) res.write(chunk);
  res.end();
}
