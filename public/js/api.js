// Tiny fetch wrapper for the local API.
const API = {
  async request(path, options = {}) {
    const res = await fetch(path, {
      headers: options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
      body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
    });
    if (res.status === 401 && typeof showLoginOverlay === 'function') showLoginOverlay();
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  },
  get: (path) => API.request(path),
  post: (path, body) => API.request(path, { method: 'POST', body }),
  del: (path) => API.request(path, { method: 'DELETE' }),
  upload(path, files) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return API.request(path, { method: 'POST', body: fd });
  },
};
