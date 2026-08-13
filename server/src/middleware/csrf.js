// Lightweight CSRF mitigation appropriate for a same-origin, cookie-authenticated
// app: the auth cookie is already sameSite:'lax' (blocks cross-site simple-form
// submissions), and this adds an Origin/Referer allowlist check on every
// mutating request as defense in depth — cheaper and better-maintained than
// pulling in the abandoned `csurf` package for what this app needs.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function verifyOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const allowed = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());
  const origin = req.headers.origin || req.headers.referer;
  if (!origin || !allowed.some((a) => origin.startsWith(a))) {
    return next(Object.assign(new Error('Cross-origin request blocked'), { status: 403 }));
  }
  next();
}
