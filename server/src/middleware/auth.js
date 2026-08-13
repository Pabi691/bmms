import db from '../db.js';
import {
  verifyAccessToken, touchAndValidateSession,
} from '../services/auth.js';

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const COOKIE_NAME = 'sl_sess';
const isProd = process.env.NODE_ENV === 'production';

export function setAuthCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    signed: true,
    expires: new Date(expiresAt),
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Verifies the session cookie, confirms the session hasn't been revoked/
// expired/idle-timed-out, loads the user, and blocks login for suspended
// buildings/accounts. Attaches req.user and req.sessionId.
export async function requireAuth(req, res, next) {
  try {
    const token = req.signedCookies?.[COOKIE_NAME];
    if (!token) throw err('Not signed in', 401);
    const payload = verifyAccessToken(token);
    if (!payload) throw err('Session invalid or expired', 401);
    const session = await touchAndValidateSession(payload.sid);
    if (!session) throw err('Session expired — please sign in again', 401);

    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(payload.sub);
    if (!user) throw err('Account no longer exists', 401);
    if (user.status === 'suspended') throw err('Account suspended', 403);

    if (user.building_id) {
      const building = await db.prepare('SELECT status FROM buildings WHERE id=?').get(user.building_id);
      if (building?.status === 'suspended') {
        throw err('This building has been suspended — contact your Master Admin', 403);
      }
    }

    req.user = {
      id: user.id, role: user.role, buildingId: user.building_id, flatId: user.flat_id,
      username: user.username, fullName: user.full_name, mustChangePassword: !!user.must_change_password,
    };
    req.sessionId = payload.sid;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(err('Not signed in', 401));
    if (!roles.includes(req.user.role)) return next(err('Not permitted for this role', 403));
    next();
  };
}

// master_admin bypasses; building_admin/resident must belong to this exact building.
export function assertBuildingAccess(req, buildingId) {
  if (req.user.role === 'master_admin') return;
  if (String(req.user.buildingId) !== String(buildingId)) {
    throw err('Not authorized for this building', 403);
  }
}

// Looks a row up via getterFn(...args), 404s if missing, and enforces
// building-scoping on it in one call — the retrofit workhorse for routes
// that take a bare resource id with no buildingId in the URL.
export async function loadScoped(req, getterFn, ...args) {
  const row = await getterFn(...args);
  if (!row) throw err('Not found', 404);
  assertBuildingAccess(req, row.building_id);
  return row;
}
