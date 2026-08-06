// Small hand-rolled validation helpers, matching the codebase's existing
// style (a `need(obj, fields)` guard + inline checks) rather than pulling in
// a schema-validation library for a handful of assertions.
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

export const need = (obj, fields) => {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null || obj[f] === '') throw bad(`Missing required field: ${f}`);
  }
};

export const isOneOf = (value, allowed, label = 'value') => {
  if (!allowed.includes(value)) throw bad(`Invalid ${label}`);
};

export const isNonEmptyString = (value, label, max = 500) => {
  if (typeof value !== 'string' || !value.trim()) throw bad(`${label} is required`);
  if (value.length > max) throw bad(`${label} is too long (max ${max} characters)`);
};

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;
export const isUsername = (value) => {
  if (typeof value !== 'string' || !USERNAME_RE.test(value)) {
    throw bad('Username must be 3-40 characters: lowercase letters, numbers, dot, underscore, or hyphen');
  }
};

// Express 4 only auto-forwards throws from *synchronous* handlers to the
// error middleware — a throw inside an async handler (needed anywhere we
// bcrypt-hash a password) becomes an unhandled promise rejection and
// crashes the process instead. Wrap every async route handler with this.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
