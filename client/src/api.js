const base = '/api';

async function request(path, options = {}) {
  const res = await fetch(base + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) window.dispatchEvent(new Event('sl:unauthorized'));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body: JSON.stringify(body) }),
  put: (p, body) => request(p, { method: 'PUT', body: JSON.stringify(body) }),
  del: (p) => request(p, { method: 'DELETE' }),
  // multipart upload — no Content-Type header, the browser sets the boundary
  upload: async (p, formData) => {
    const res = await fetch(base + p, { method: 'POST', credentials: 'include', body: formData });
    if (res.status === 401) window.dispatchEvent(new Event('sl:unauthorized'));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
};

export const inr = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const METHODS = [
  { v: 'cash', l: 'Cash' }, { v: 'upi', l: 'UPI' }, { v: 'bank', l: 'Bank transfer' },
  { v: 'online', l: 'Online payment' }, { v: 'other', l: 'Other' },
];
export const today = () => new Date().toISOString().slice(0, 10);
