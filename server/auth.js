/* Simple single-password web login.
   Protects every route except: static files, /api/auth/*, /api/health and the
   public student share pages (/s/:token, /api/share/* — guarded by unguessable
   token URLs instead). Password lives in the local settings table; sessions are
   in-memory tokens (a server restart simply asks everyone to log in again). */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSetting, setSetting } from './db.js';

const PASSWORD_KEY = 'web_password';
const sessions = new Set();

/* brute-force guard: 5 wrong tries → 60 s lockout (per server process) */
let fails = 0;
let lockedUntil = 0;

const sha = (s) => createHash('sha256').update(String(s ?? '')).digest();

export function passwordSet() {
  return !!getSetting(PASSWORD_KEY);
}

export function setWebPassword(pw) {
  setSetting(PASSWORD_KEY, String(pw ?? ''));
  sessions.clear(); // everyone (including this browser) must log in again
}

export function checkPassword(pw) {
  if (Date.now() < lockedUntil) return { ok: false, locked: true, retryAfter: Math.ceil((lockedUntil - Date.now()) / 1000) };
  const stored = getSetting(PASSWORD_KEY);
  const ok = stored ? timingSafeEqual(sha(pw), sha(stored)) : true;
  if (ok) { fails = 0; return { ok: true }; }
  fails += 1;
  if (fails >= 5) { lockedUntil = Date.now() + 60_000; fails = 0; }
  return { ok: false, locked: false };
}

export function createSession() {
  const token = randomBytes(24).toString('hex');
  sessions.add(token);
  return token;
}
export function destroySession(token) {
  if (token) sessions.delete(token);
}
export function sessionValid(token) {
  return !!token && sessions.has(token);
}

export function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export function cookieToken(req) {
  return parseCookies(req.headers.cookie).hkat_auth;
}

export function setAuthCookie(res, token) {
  const secure = req_isSecure(res.req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `hkat_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure}`);
}
export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'hkat_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function req_isSecure(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/* Express middleware — mount early, before all protected routes. */
export function requireAuth(req, res, next) {
  if (!passwordSet()) return next(); // no password configured → open (LAN-only setups)
  const p = req.path;
  if (p.startsWith('/api/auth') || p === '/api/health') return next();
  if (p.startsWith('/api/share/') || p.startsWith('/s/')) return next(); // student share links
  if (sessionValid(cookieToken(req))) return next();
  res.status(401).json({ error: '需要登入先使用（密碼保護）Login required' });
}
