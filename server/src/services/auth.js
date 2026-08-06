import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required');

const ABSOLUTE_TTL_MIN = Number(process.env.SESSION_ABSOLUTE_TTL_MIN || 240);
const INACTIVITY_TIMEOUT_MIN = Number(process.env.SESSION_INACTIVITY_TIMEOUT_MIN || 30);
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MIN = 15;

// ---------- passwords ----------
export const hashPassword = (plain) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function assertStrongPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) {
    throw err('Password must be at least 10 characters');
  }
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) {
    throw err('Password must include both letters and numbers');
  }
}

export function generatePassword() {
  // 12 chars, letters+digits, always satisfies assertStrongPassword
  const bytes = crypto.randomBytes(12);
  return bytes.toString('base64').replace(/[+/=]/g, '').slice(0, 12) + '7a';
}

// ---------- sessions ----------
// Session timestamps are always supplied by the app as proper ISO-8601 UTC
// strings (never SQLite's `datetime('now')`) — SQLite's naive
// "YYYY-MM-DD HH:MM:SS" (no timezone marker) gets silently misread as
// *local* time by JS's Date parser, which is wrong by a full UTC offset on
// any non-UTC server.
export function issueSession({ userId, ip, userAgent }) {
  const id = crypto.randomBytes(24).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ABSOLUTE_TTL_MIN * 60000).toISOString();
  db.prepare(
    'INSERT INTO sessions (id, user_id, ip, user_agent, created_at, last_active_at, expires_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, userId, ip || null, userAgent || null, now, now, expiresAt);
  return { id, expiresAt };
}

export function signAccessToken({ userId, sessionId, role }) {
  return jwt.sign({ sub: userId, sid: sessionId, role }, JWT_SECRET, {
    expiresIn: `${ABSOLUTE_TTL_MIN}m`,
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Returns the (touched) session row, or null if it's missing/revoked/expired/idle-timed-out.
export function touchAndValidateSession(sessionId) {
  const row = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  if (!row || row.revoked) return null;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) return null;
  const idleMs = now - new Date(row.last_active_at).getTime();
  if (idleMs > INACTIVITY_TIMEOUT_MIN * 60000) return null;
  db.prepare('UPDATE sessions SET last_active_at = ? WHERE id=?').run(new Date().toISOString(), sessionId);
  return row;
}

export function revokeSession(sessionId, reason = 'logout') {
  db.prepare('UPDATE sessions SET revoked=1, revoked_reason=? WHERE id=?').run(reason, sessionId);
}

export function revokeUserSessions(userId, reason = 'admin_action', exceptSessionId = null) {
  db.prepare(
    'UPDATE sessions SET revoked=1, revoked_reason=? WHERE user_id=? AND revoked=0 AND id != ?'
  ).run(reason, userId, exceptSessionId || '');
}

// ---------- brute-force lockout (per account, on top of the login-route rate limiter) ----------
export function isLocked(user) {
  return !!(user.locked_until && new Date(user.locked_until).getTime() > Date.now());
}

export function registerFailedLogin(userId) {
  const user = db.prepare('SELECT failed_login_count FROM users WHERE id=?').get(userId);
  const count = (user?.failed_login_count || 0) + 1;
  const lockedUntil = count >= MAX_FAILED_LOGINS
    ? new Date(Date.now() + LOCKOUT_MIN * 60000).toISOString()
    : null;
  db.prepare('UPDATE users SET failed_login_count=?, locked_until=? WHERE id=?')
    .run(count, lockedUntil, userId);
}

export function clearFailedLogins(userId) {
  db.prepare('UPDATE users SET failed_login_count=0, locked_until=NULL WHERE id=?').run(userId);
}
