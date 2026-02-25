const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch {}

const PORT = Number(process.env.PORT || 8787);
const ROOT = process.cwd();
const DATA_DIR_INPUT = String(process.env.YV_DATA_DIR || "").trim();
const DATA_DIR = DATA_DIR_INPUT
  ? (path.isAbsolute(DATA_DIR_INPUT) ? DATA_DIR_INPUT : path.join(ROOT, DATA_DIR_INPUT))
  : path.join(ROOT, ".yv-data");
const DATA_FILE = path.join(DATA_DIR, "users.json");
const SESSION_FILE = path.join(DATA_DIR, "sessions.json");
const SECURITY_LOG_FILE = path.join(DATA_DIR, "security.log");

function loadLocalEnvFiles() {
  const files = [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")];
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const lines = String(raw || "").split(/\r?\n/);
    for (const lineRaw of lines) {
      const line = String(lineRaw || "").trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (!key || process.env[key]) continue;
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

loadLocalEnvFiles();

const ANILIST_URL = "https://graphql.anilist.co";
const JIKAN_URL = "https://api.jikan.moe/v4";
const KITSU_URL = "https://kitsu.io/api/edge";
const TRANSLATE_URL = "https://api.mymemory.translated.net/get";
const GOOGLE_TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";

const DEFAULT_SESSION_SECRET = "yv_change_this_secret";
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET).trim();
const SESSION_COOKIE = "yv_sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LEN_RAW = Number(process.env.PASSWORD_MIN_LEN || 8);
const PASSWORD_MIN_LEN =
  Number.isFinite(PASSWORD_MIN_LEN_RAW) && PASSWORD_MIN_LEN_RAW >= 8 ? Math.floor(PASSWORD_MIN_LEN_RAW) : 8;
const PASSWORD_REQUIRE_LETTER = true;
const PASSWORD_REQUIRE_NUMBER = true;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AUTH_RATE_WINDOW_MS = 10 * 60 * 1000;
const AUTH_RATE_MAX_ATTEMPTS = 8;
const AUTH_RATE_LOCK_MS = 15 * 60 * 1000;
const AUTH_RATE_MAX_LOCK_MS = 12 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const PASSWORD_RESET_MAX_ACTIVE_PER_USER = 5;
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const EMAIL_VERIFY_MAX_ACTIVE_PER_USER = 5;

const SESSION_COOKIE_SAMESITE_INPUT = String(process.env.SESSION_COOKIE_SAMESITE || "Lax")
  .trim()
  .toLowerCase();
const SESSION_COOKIE_SAMESITE =
  SESSION_COOKIE_SAMESITE_INPUT === "strict"
    ? "Strict"
    : SESSION_COOKIE_SAMESITE_INPUT === "none"
      ? "None"
      : "Lax";
const SESSION_COOKIE_SECURE_MODE = String(process.env.SESSION_COOKIE_SECURE || "auto")
  .trim()
  .toLowerCase();

const APP_BASE_URL = String(process.env.APP_BASE_URL || "").trim();
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "").trim();
const SMTP_FROM = String(process.env.SMTP_FROM || "").trim();
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").trim() === "true";

const MAX_FAVORITES = 200;
const MAX_PENDING = 200;
const MAX_HISTORY = 300;

const CACHE = new Map();
const MAX_CACHE_ITEMS = 700;
const SESSIONS = new Map();
const AUTH_RATE = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const recommendationPoolQuery = `
query RecommendationPool {
  trending: Page(page: 1, perPage: 40) {
    media(type: ANIME, sort: TRENDING_DESC) {
      id
      idMal
      title { romaji english native }
      episodes
      averageScore
      seasonYear
      status
      genres
      coverImage { extraLarge large medium }
      bannerImage
    }
  }
  season: Page(page: 1, perPage: 40) {
    media(type: ANIME, sort: POPULARITY_DESC) {
      id
      idMal
      title { romaji english native }
      episodes
      averageScore
      seasonYear
      status
      genres
      coverImage { extraLarge large medium }
      bannerImage
    }
  }
  top: Page(page: 1, perPage: 40) {
    media(type: ANIME, sort: SCORE_DESC) {
      id
      idMal
      title { romaji english native }
      episodes
      averageScore
      seasonYear
      status
      genres
      coverImage { extraLarge large medium }
      bannerImage
    }
  }
}
`;

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const smtpReady = Boolean(nodemailer && SMTP_HOST && SMTP_FROM && Number.isFinite(SMTP_PORT) && SMTP_PORT > 0);
const mailTransport = smtpReady
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    })
  : null;

function isPasswordResetAvailable() {
  return process.env.NODE_ENV !== "production" || smtpReady;
}

function now() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function cacheGet(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    CACHE.delete(key);
    return null;
  }
  entry.lastAccess = now();
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  CACHE.set(key, { value, expiresAt: now() + ttlMs, lastAccess: now() });
  if (CACHE.size <= MAX_CACHE_ITEMS) return;
  let oldestKey = null;
  let oldestAt = Infinity;
  for (const [k, v] of CACHE.entries()) {
    if (v.lastAccess < oldestAt) {
      oldestAt = v.lastAccess;
      oldestKey = k;
    }
  }
  if (oldestKey) CACHE.delete(oldestKey);
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Payload demasiado grande"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function readJsonBody(req, res) {
  try {
    const raw = await readBody(req);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "JSON invalido" });
    return null;
  }
}

async function fetchJson(url, options = {}, retries = 1) {
  const response = await fetch(url, options);
  if (response.status === 429 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return fetchJson(url, options, retries - 1);
  }
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: response.status, ok: response.ok, json };
}

function cleanText(text) {
  return String(text || "")
    .replace(/\(\s*source\s*:[^)]+\)\s*$/i, "")
    .replace(/\(\s*fuente\s*:[^)]+\)\s*$/i, "")
    .replace(/\bsource\s*:[^.]+\.?\s*$/i, "")
    .replace(/\bfuente\s*:[^.]+\.?\s*$/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) return "";
  return url;
}

function decodeJwtPayload(token) {
  const raw = String(token || "").trim();
  if (!raw) return {};
  const parts = raw.split(".");
  if (parts.length < 2) return {};
  let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const mod = payload.length % 4;
  if (mod) payload += "=".repeat(4 - mod);
  try {
    const decoded = Buffer.from(payload, "base64").toString("utf8");
    const json = JSON.parse(decoded);
    return json && typeof json === "object" ? json : {};
  } catch {
    return {};
  }
}

function normalizeGooglePicture(value) {
  const input = cleanUrl(value);
  if (!input) return "";
  try {
    const u = new URL(input);
    const host = String(u.hostname || "").toLowerCase();
    const isGoogleHost = host.endsWith("googleusercontent.com") || host.endsWith("gstatic.com");
    const out = isGoogleHost
      ? input
          .replace(/=s\d+-c(?=(&|$))/i, "=s256-c")
          .replace(/=s\d+(?=(&|$))/i, "=s256-c")
      : input;
    return cleanUrl(out);
  } catch {
    return input;
  }
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return EMAIL_RE.test(normalizeEmail(email));
}

function hashPassword(password, salt = "") {
  const raw = String(password || "");
  const safeSalt = String(salt || crypto.randomBytes(16).toString("base64url"));
  const hash = crypto.scryptSync(raw, safeSalt, 64).toString("base64url");
  return { salt: safeSalt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const safeSalt = String(salt || "");
  const safeHash = String(expectedHash || "");
  if (!safeSalt || !safeHash) return false;
  const incoming = hashPassword(password, safeSalt).hash;
  const a = Buffer.from(incoming, "utf8");
  const b = Buffer.from(safeHash, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizeDisplayName(value) {
  const clean = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return clean || "Usuario";
}

function chooseBestTitle(payload) {
  return cleanText(payload?.titleEnglish || payload?.titleRomaji || payload?.titleNative || payload?.title || "");
}

function toPositiveIntArray(input, max = 40) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(input) ? input : [];
  for (const raw of list) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeGenres(input, max = 8) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(input) ? input : [];
  for (const raw of list) {
    const genre = String(raw || "")
      .trim()
      .slice(0, 32);
    if (!genre || seen.has(genre)) continue;
    seen.add(genre);
    out.push(genre);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeAnimePayload(raw) {
  const animeId = Number(raw?.animeId || raw?.id || 0);
  if (!Number.isInteger(animeId) || animeId <= 0) return null;

  const title = cleanText(raw?.title || "").slice(0, 180);
  if (!title) return null;

  const idMal = Number(raw?.idMal || 0);
  const episodes = Number(raw?.episodes || 0);
  const score = Number(raw?.score || 0);
  const seasonYear = Number(raw?.seasonYear || 0);

  return {
    animeId,
    idMal: Number.isInteger(idMal) && idMal > 0 ? idMal : 0,
    title,
    cover: cleanUrl(raw?.cover),
    banner: cleanUrl(raw?.banner),
    status: cleanText(raw?.status || "").slice(0, 32),
    episodes: Number.isInteger(episodes) && episodes > 0 ? episodes : 0,
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    seasonYear: Number.isInteger(seasonYear) && seasonYear > 1900 ? seasonYear : 0,
    genres: sanitizeGenres(raw?.genres, 8)
  };
}

function sanitizeHistoryPayload(body) {
  const anime = sanitizeAnimePayload(body?.anime || {});
  if (!anime) return null;

  const episodeNumber = Number(body?.episodeNumber || 0);
  const totalEpisodes = Number(body?.totalEpisodes || anime.episodes || 0);

  return {
    ...anime,
    episodeNumber: Number.isInteger(episodeNumber) && episodeNumber > 0 ? episodeNumber : 1,
    episodeTitle: cleanText(body?.episodeTitle || "").slice(0, 180),
    totalEpisodes: Number.isInteger(totalEpisodes) && totalEpisodes > 0 ? totalEpisodes : anime.episodes || 0,
    updatedAt: now()
  };
}

function parseCookies(cookieHeader) {
  const out = {};
  const raw = String(cookieHeader || "");
  if (!raw) return out;
  const parts = raw.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function signSessionId(sessionId) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(sessionId).digest("base64url");
}

function shouldUseSecureSessionCookie() {
  if (SESSION_COOKIE_SECURE_MODE === "always") return true;
  if (SESSION_COOKIE_SECURE_MODE === "never") return false;
  return process.env.NODE_ENV === "production" || SESSION_COOKIE_SAMESITE === "None";
}

function sessionCookieBase(maxAgeSec) {
  const secure = shouldUseSecureSessionCookie() ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=${SESSION_COOKIE_SAMESITE}; Max-Age=${maxAgeSec}${secure}`;
}

function setSessionCookie(res, sessionId) {
  const token = `${sessionId}.${signSessionId(sessionId)}`;
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${sessionCookieBase(maxAgeSec)}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; ${sessionCookieBase(0)}`);
}

function defaultSessionStore() {
  return {
    version: 1,
    sessions: {}
  };
}

let sessionPersistTimer = null;
function persistSessionsSoon(delayMs = 700) {
  if (sessionPersistTimer) return;
  sessionPersistTimer = setTimeout(() => {
    sessionPersistTimer = null;
    saveSessionStore();
  }, delayMs);
  if (typeof sessionPersistTimer.unref === "function") {
    sessionPersistTimer.unref();
  }
}

function loadSessionStore() {
  ensureDataStore();
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const raw = fs.readFileSync(SESSION_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const source = parsed?.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {};
    const ts = now();
    Object.entries(source).forEach(([sessionId, data]) => {
      const userId = String(data?.userId || "");
      const expiresAt = Number(data?.expiresAt || 0);
      if (!sessionId || !userId || !Number.isFinite(expiresAt) || expiresAt <= ts) return;
      const createdAt = cleanText(data?.createdAt || nowIso()).slice(0, 48) || nowIso();
      const lastSeenAt = cleanText(data?.lastSeenAt || createdAt).slice(0, 48) || createdAt;
      const ip = cleanText(data?.ip || "").slice(0, 96);
      const ua = cleanText(data?.ua || "").slice(0, 220);
      SESSIONS.set(sessionId, { userId, expiresAt, createdAt, lastSeenAt, ip, ua });
    });
  } catch {}
}

function saveSessionStore() {
  ensureDataStore();
  const sessions = {};
  const ts = now();
  for (const [sessionId, data] of SESSIONS.entries()) {
    if (!data?.userId || !Number.isFinite(data?.expiresAt) || data.expiresAt <= ts) continue;
    sessions[sessionId] = {
      userId: String(data.userId),
      expiresAt: Number(data.expiresAt),
      createdAt: cleanText(data.createdAt || "").slice(0, 48),
      lastSeenAt: cleanText(data.lastSeenAt || "").slice(0, 48),
      ip: cleanText(data.ip || "").slice(0, 96),
      ua: cleanText(data.ua || "").slice(0, 220)
    };
  }
  const payload = {
    ...defaultSessionStore(),
    sessions
  };
  const temp = `${SESSION_FILE}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(temp, SESSION_FILE);
  } catch {}
}

function createSession(userId, req = null) {
  const startedAt = nowIso();
  const ip = req ? cleanText(getClientIp(req)).slice(0, 96) : "";
  const uaRaw = req ? String(req.headers?.["user-agent"] || "") : "";
  const ua = cleanText(summarizeUserAgent(uaRaw)).slice(0, 220);
  const sessionId = crypto.randomBytes(24).toString("base64url");
  SESSIONS.set(sessionId, {
    userId,
    expiresAt: now() + SESSION_TTL_MS,
    createdAt: startedAt,
    lastSeenAt: startedAt,
    ip,
    ua
  });
  persistSessionsSoon();
  return sessionId;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = String(cookies[SESSION_COOKIE] || "");
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const sessionId = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  const expected = signSessionId(sessionId);
  if (!signature || signature !== expected) return null;

  const session = SESSIONS.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= now()) {
    SESSIONS.delete(sessionId);
    persistSessionsSoon();
    return null;
  }
  if (!session.ip) {
    session.ip = cleanText(getClientIp(req)).slice(0, 96);
  }
  if (!session.ua) {
    const uaRaw = String(req.headers?.["user-agent"] || "");
    session.ua = cleanText(summarizeUserAgent(uaRaw)).slice(0, 220);
  }
  const nextExpiresAt = now() + SESSION_TTL_MS;
  const beforeLastSeenTs = Date.parse(String(session.lastSeenAt || ""));
  const nextLastSeenAt = nowIso();
  session.lastSeenAt = nextLastSeenAt;
  // Evita escribir en disco en cada request; persiste solo si el cambio de TTL es relevante.
  if (Math.abs(nextExpiresAt - Number(session.expiresAt || 0)) > 60_000) {
    session.expiresAt = nextExpiresAt;
    persistSessionsSoon(1200);
  } else {
    session.expiresAt = nextExpiresAt;
    const shouldPersistSeen =
      !Number.isFinite(beforeLastSeenTs) || Math.abs(now() - beforeLastSeenTs) > 3 * 60 * 1000;
    if (shouldPersistSeen) persistSessionsSoon(1200);
  }
  return { sessionId, ...session };
}

function pruneExpiredSessions() {
  const ts = now();
  let changed = false;
  for (const [sid, session] of SESSIONS.entries()) {
    if (!session || session.expiresAt <= ts) {
      SESSIONS.delete(sid);
      changed = true;
    }
  }
  if (changed) persistSessionsSoon();
}

function flushSessionStoreNow() {
  if (sessionPersistTimer) {
    clearTimeout(sessionPersistTimer);
    sessionPersistTimer = null;
  }
  saveSessionStore();
}

function getClientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").trim();
  if (xff) return xff.split(",")[0].trim();
  const xri = String(req.headers["x-real-ip"] || "").trim();
  if (xri) return xri;
  return String(req.socket?.remoteAddress || "ip_unknown");
}

function summarizeUserAgent(uaRaw) {
  const ua = String(uaRaw || "");
  if (!ua) return "Dispositivo desconocido";

  let browser = "Navegador";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  let os = "SO desconocido";
  if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Mac OS X/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/(iPhone|iPad|iPod)/i.test(ua)) os = "iOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  const device = /Mobile|Android|iPhone|iPad|iPod/i.test(ua) ? "Movil" : "Escritorio";
  return `${browser} en ${os} (${device})`;
}

function authRateKey(req, scope, identifier = "") {
  const ip = getClientIp(req);
  const id = String(identifier || "").trim().toLowerCase();
  return `${scope}:${ip}:${id}`;
}

function checkAuthRateLimit(req, scope, identifier = "") {
  const key = authRateKey(req, scope, identifier);
  const ts = now();
  const entry = AUTH_RATE.get(key);
  if (!entry) return { allowed: true, retryAfterSec: 0 };

  if (entry.lockedUntil && entry.lockedUntil > ts) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.lockedUntil - ts) / 1000));
    return { allowed: false, retryAfterSec };
  }

  if (entry.lockedUntil && entry.lockedUntil <= ts) {
    entry.lockedUntil = 0;
    entry.attempts = 0;
    entry.windowStart = ts;
    AUTH_RATE.set(key, entry);
  }

  if (entry.windowStart + AUTH_RATE_WINDOW_MS <= ts && !entry.lockedUntil) {
    AUTH_RATE.delete(key);
    return { allowed: true, retryAfterSec: 0 };
  }

  return { allowed: true, retryAfterSec: 0 };
}

function registerAuthFailure(req, scope, identifier = "") {
  const key = authRateKey(req, scope, identifier);
  const ts = now();
  let entry = AUTH_RATE.get(key);
  if (!entry) {
    entry = { attempts: 0, windowStart: ts, lockedUntil: 0, lockCount: 0, lastFailedAt: ts };
  } else if (!entry.lockedUntil && entry.windowStart + AUTH_RATE_WINDOW_MS <= ts) {
    entry = { attempts: 0, windowStart: ts, lockedUntil: 0, lockCount: 0, lastFailedAt: ts };
  } else if (!Number.isFinite(entry.lockCount) || entry.lockCount < 0) {
    entry.lockCount = 0;
  }

  entry.attempts += 1;
  entry.lastFailedAt = ts;
  if (entry.attempts >= AUTH_RATE_MAX_ATTEMPTS) {
    entry.lockCount = Math.min(20, Number(entry.lockCount || 0) + 1);
    const lockMultiplier = Math.pow(2, Math.max(0, entry.lockCount - 1));
    const lockMs = Math.min(AUTH_RATE_MAX_LOCK_MS, AUTH_RATE_LOCK_MS * lockMultiplier);
    entry.lockedUntil = ts + lockMs;
    entry.attempts = 0;
    entry.windowStart = ts;
  }
  AUTH_RATE.set(key, entry);
}

function registerAuthSuccess(req, scope, identifier = "") {
  const key = authRateKey(req, scope, identifier);
  if (AUTH_RATE.has(key)) AUTH_RATE.delete(key);
}

function pruneAuthRateMap() {
  const ts = now();
  const staleTtlMs = Math.max(AUTH_RATE_MAX_LOCK_MS, AUTH_RATE_WINDOW_MS * 2);
  for (const [key, entry] of AUTH_RATE.entries()) {
    if (!entry || typeof entry !== "object") {
      AUTH_RATE.delete(key);
      continue;
    }
    const lockActive = Number(entry.lockedUntil || 0) > ts;
    const touchedAt = Math.max(
      Number(entry.lastFailedAt || 0),
      Number(entry.windowStart || 0),
      Number(entry.lockedUntil || 0)
    );
    if (!lockActive && (!Number.isFinite(touchedAt) || touchedAt + staleTtlMs <= ts)) {
      AUTH_RATE.delete(key);
    }
  }
}

function sendRateLimited(res, retryAfterSec) {
  sendJson(
    res,
    429,
    {
      error: "Demasiados intentos. Espera antes de volver a intentar.",
      retryAfterSec
    },
    {
      "Retry-After": String(retryAfterSec)
    }
  );
}

function getPasswordPolicyMessage(label = "La contrasena") {
  const checks = [`al menos ${PASSWORD_MIN_LEN} caracteres`];
  if (PASSWORD_REQUIRE_LETTER) checks.push("al menos una letra");
  if (PASSWORD_REQUIRE_NUMBER) checks.push("al menos un numero");
  return `${label} debe tener ${checks.join(", ")}.`;
}

function validatePasswordStrength(password, label = "La contrasena") {
  const safePassword = String(password || "");
  if (safePassword.length < PASSWORD_MIN_LEN) {
    return { ok: false, error: getPasswordPolicyMessage(label), reason: "min_len" };
  }
  if (PASSWORD_REQUIRE_LETTER && !/[A-Za-z]/.test(safePassword)) {
    return { ok: false, error: getPasswordPolicyMessage(label), reason: "missing_letter" };
  }
  if (PASSWORD_REQUIRE_NUMBER && !/[0-9]/.test(safePassword)) {
    return { ok: false, error: getPasswordPolicyMessage(label), reason: "missing_number" };
  }
  return { ok: true, error: "", reason: "" };
}

const STATEFUL_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeOrigin(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function requestOriginFromHeaders(req) {
  const origin = normalizeOrigin(req?.headers?.origin || "");
  if (origin) return origin;
  return normalizeOrigin(req?.headers?.referer || "");
}

function expectedOrigin(req) {
  const host = cleanText(req?.headers?.host || "").toLowerCase();
  if (!host) return "";
  const xfpRaw = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const proto = xfpRaw === "https" ? "https:" : "http:";
  return `${proto}//${host}`;
}

function isApiStateChangingRequest(req, parsedUrl) {
  const method = String(req?.method || "").toUpperCase();
  if (!STATEFUL_HTTP_METHODS.has(method)) return false;
  const pathname = String(parsedUrl?.pathname || "");
  return pathname.startsWith("/api/");
}

function enforceApiOriginPolicy(req, res, parsedUrl) {
  if (!isApiStateChangingRequest(req, parsedUrl)) return true;

  const actualOrigin = requestOriginFromHeaders(req);
  const allowedOrigin = expectedOrigin(req);
  if (!allowedOrigin) return true;

  if (!actualOrigin) {
    if (process.env.NODE_ENV === "production") {
      writeSecurityEvent("csrf_blocked", req, {
        reason: "missing_origin",
        path: securityValue(parsedUrl?.pathname || "", 120),
        method: securityValue(req?.method || "", 12),
        expectedOrigin: securityValue(allowedOrigin, 120)
      });
      sendJson(res, 403, { error: "Solicitud bloqueada por seguridad" });
      return false;
    }
    return true;
  }

  if (actualOrigin !== allowedOrigin) {
    writeSecurityEvent("csrf_blocked", req, {
      reason: "origin_mismatch",
      path: securityValue(parsedUrl?.pathname || "", 120),
      method: securityValue(req?.method || "", 12),
      origin: securityValue(actualOrigin, 120),
      expectedOrigin: securityValue(allowedOrigin, 120)
    });
    sendJson(res, 403, { error: "Solicitud bloqueada por seguridad" });
    return false;
  }

  return true;
}

function securityValue(input, max = 180) {
  return cleanText(input || "").slice(0, max);
}

function writeSecurityEvent(event, req = null, payload = {}) {
  try {
    ensureDataStore();
    const entry = {
      at: nowIso(),
      event: securityValue(event, 80) || "event_unknown",
      ip: req ? securityValue(getClientIp(req), 96) : "",
      ua: req ? securityValue(summarizeUserAgent(String(req.headers?.["user-agent"] || "")), 220) : "",
      ...payload
    };
    fs.appendFile(SECURITY_LOG_FILE, `${JSON.stringify(entry)}\n`, () => {});
  } catch {}
}

function validateSessionSecret() {
  const weakSecret = !SESSION_SECRET || SESSION_SECRET === DEFAULT_SESSION_SECRET || SESSION_SECRET.length < 24;
  if (!weakSecret) return;
  const message = "SESSION_SECRET es debil. Usa una clave aleatoria larga (minimo 24 caracteres).";
  if (process.env.NODE_ENV === "production") {
    throw new Error(message);
  }
  console.warn(`Aviso: ${message}`);
}

function validateSessionCookieConfig() {
  if (SESSION_COOKIE_SAMESITE !== "None") return;
  if (shouldUseSecureSessionCookie()) return;

  const message = "SESSION_COOKIE_SAMESITE=None requiere cookie Secure activa.";
  if (process.env.NODE_ENV === "production") {
    throw new Error(message);
  }
  console.warn(`Aviso: ${message}`);
}

function ensureDataStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

function defaultDatabase() {
  return {
    version: 1,
    users: {},
    googleIndex: {},
    emailIndex: {},
    profiles: {},
    passwordResetTokens: {},
    emailVerifyTokens: {}
  };
}

function loadDatabase() {
  ensureDataStore();
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initial = defaultDatabase();
      fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultDatabase();
    return {
      ...defaultDatabase(),
      ...parsed,
      users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
      googleIndex: parsed.googleIndex && typeof parsed.googleIndex === "object" ? parsed.googleIndex : {},
      emailIndex: parsed.emailIndex && typeof parsed.emailIndex === "object" ? parsed.emailIndex : {},
      profiles: parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {},
      passwordResetTokens:
        parsed.passwordResetTokens && typeof parsed.passwordResetTokens === "object" ? parsed.passwordResetTokens : {},
      emailVerifyTokens:
        parsed.emailVerifyTokens && typeof parsed.emailVerifyTokens === "object" ? parsed.emailVerifyTokens : {}
    };
  } catch {
    return defaultDatabase();
  }
}

function saveDatabase() {
  ensureDataStore();
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(DB, null, 2), "utf8");
  fs.renameSync(temp, DATA_FILE);
}

function ensureProfile(userId) {
  const uid = String(userId || "");
  if (!uid) return null;
  if (!DB.profiles[uid] || typeof DB.profiles[uid] !== "object") {
    DB.profiles[uid] = {
      favorites: [],
      pending: [],
      history: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }
  const profile = DB.profiles[uid];
  if (!Array.isArray(profile.favorites)) profile.favorites = [];
  if (!Array.isArray(profile.pending)) profile.pending = [];
  if (!Array.isArray(profile.history)) profile.history = [];
  if (!profile.createdAt) profile.createdAt = nowIso();
  if (!profile.updatedAt) profile.updatedAt = nowIso();
  return profile;
}

function profileStats(profile) {
  return {
    favorites: Array.isArray(profile?.favorites) ? profile.favorites.length : 0,
    pending: Array.isArray(profile?.pending) ? profile.pending.length : 0,
    history: Array.isArray(profile?.history) ? profile.history.length : 0
  };
}

function isUserEmailVerified(user) {
  if (!user) return false;
  if (user.emailVerificationPending === true) return false;
  if (user.emailVerificationPending === undefined) return true;
  return Boolean(cleanText(user.emailVerifiedAt || "").slice(0, 48));
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture || "",
    authProviders: normalizeProviders(user.authProviders || []),
    emailVerified: isUserEmailVerified(user),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt
  };
}

function profilePayload(profile) {
  return {
    favorites: (profile?.favorites || []).slice(0, MAX_FAVORITES),
    pending: (profile?.pending || []).slice(0, MAX_PENDING),
    history: (profile?.history || []).slice(0, MAX_HISTORY),
    stats: profileStats(profile)
  };
}

function listToggle(profile, listName, entry, maxItems) {
  const list = Array.isArray(profile[listName]) ? profile[listName] : [];
  const animeId = Number(entry.animeId || 0);
  const existingIdx = list.findIndex((item) => Number(item?.animeId || 0) === animeId);
  let added = false;
  if (existingIdx >= 0) {
    list.splice(existingIdx, 1);
  } else {
    list.unshift({
      ...entry,
      savedAt: now()
    });
    if (list.length > maxItems) list.length = maxItems;
    added = true;
  }
  profile[listName] = list;
  profile.updatedAt = nowIso();
  return { added };
}

function upsertHistory(profile, entry) {
  const list = Array.isArray(profile.history) ? profile.history : [];
  const animeId = Number(entry.animeId || 0);
  const idx = list.findIndex((item) => Number(item?.animeId || 0) === animeId);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(entry);
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  profile.history = list;
  profile.updatedAt = nowIso();
}

function removeHistoryByAnimeId(profile, animeIdRaw) {
  const animeId = Number(animeIdRaw || 0);
  if (!Number.isInteger(animeId) || animeId <= 0) return false;
  const list = Array.isArray(profile.history) ? profile.history : [];
  const next = list.filter((item) => Number(item?.animeId || 0) !== animeId);
  if (next.length === list.length) return false;
  profile.history = next;
  profile.updatedAt = nowIso();
  return true;
}

function clearHistory(profile) {
  profile.history = [];
  profile.updatedAt = nowIso();
}

function buildGenreWeights(profile) {
  const weights = new Map();
  const addGenres = (items, baseWeight) => {
    (items || []).forEach((item, idx) => {
      const factor = Math.max(1, baseWeight - Math.floor(idx / 3));
      sanitizeGenres(item?.genres || [], 8).forEach((genre) => {
        weights.set(genre, (weights.get(genre) || 0) + factor);
      });
    });
  };

  addGenres(profile?.history || [], 6);
  addGenres(profile?.favorites || [], 5);
  addGenres(profile?.pending || [], 3);
  return weights;
}

function dedupeMedia(list) {
  const out = [];
  const seen = new Set();
  (list || []).forEach((item) => {
    const id = Number(item?.id || 0);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(item);
  });
  return out;
}

function pickTitle(title) {
  return cleanText(title?.english || title?.romaji || title?.native || "Anime") || "Anime";
}

function bestCover(coverImage) {
  return cleanUrl(coverImage?.extraLarge || coverImage?.large || coverImage?.medium || "");
}

function toRecommendationItem(media) {
  return {
    animeId: Number(media?.id || 0),
    idMal: Number(media?.idMal || 0),
    title: pickTitle(media?.title),
    cover: bestCover(media?.coverImage),
    banner: cleanUrl(media?.bannerImage || ""),
    score: Number(media?.averageScore || 0) || 0,
    status: cleanText(media?.status || ""),
    episodes: Number(media?.episodes || 0) || 0,
    seasonYear: Number(media?.seasonYear || 0) || 0,
    genres: sanitizeGenres(media?.genres || [], 8)
  };
}

async function fetchRecommendationPool() {
  const cacheKey = "recommendation_pool_v1";
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const upstream = await fetchJson(ANILIST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ query: recommendationPoolQuery, variables: {} })
  });

  if (!upstream.ok || upstream.json?.errors) {
    throw new Error("No se pudo cargar pool de recomendaciones");
  }

  const data = upstream.json?.data || {};
  const pool = dedupeMedia([
    ...(data?.trending?.media || []),
    ...(data?.season?.media || []),
    ...(data?.top?.media || [])
  ]).map(toRecommendationItem);

  cacheSet(cacheKey, pool, 10 * 60 * 1000);
  return pool;
}

async function buildRecommendations(profile, limit = 24) {
  const genreWeights = buildGenreWeights(profile);
  if (!genreWeights.size) return [];

  const blocked = new Set([
    ...(profile?.history || []).map((item) => Number(item?.animeId || 0)),
    ...(profile?.favorites || []).map((item) => Number(item?.animeId || 0)),
    ...(profile?.pending || []).map((item) => Number(item?.animeId || 0))
  ]);

  const pool = await fetchRecommendationPool();
  return pool
    .filter((item) => !blocked.has(Number(item?.animeId || 0)))
    .map((item) => {
      const genreScore = (item.genres || []).reduce((sum, genre) => sum + (genreWeights.get(genre) || 0), 0);
      const statusBoost = item.status === "RELEASING" ? 4 : 0;
      return {
        item,
        rank: genreScore * 12 + Number(item.score || 0) + statusBoost
      };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((row) => row.item);
}

function getAuthContext(req) {
  const session = getSessionFromRequest(req);
  if (!session) return null;
  const user = DB.users[session.userId];
  if (!user) return null;
  return { ...session, user };
}

function requireAuth(req, res) {
  const context = getAuthContext(req);
  if (!context) {
    sendJson(res, 401, { error: "No autenticado" });
    return null;
  }
  return context;
}

function listActiveSessionsForUser(userId, currentSessionId = "") {
  const uid = String(userId || "");
  const nowTs = now();
  const currentId = String(currentSessionId || "");
  const items = [];

  for (const [sid, session] of SESSIONS.entries()) {
    if (!session || session.userId !== uid) continue;
    if (!Number.isFinite(session.expiresAt) || session.expiresAt <= nowTs) continue;
    items.push({
      sessionId: sid,
      isCurrent: sid === currentId,
      createdAt: cleanText(session.createdAt || "").slice(0, 48),
      lastSeenAt: cleanText(session.lastSeenAt || "").slice(0, 48),
      expiresAt: Number(session.expiresAt),
      ip: cleanText(session.ip || "").slice(0, 96),
      ua: cleanText(session.ua || "").slice(0, 220)
    });
  }

  return items.sort((a, b) => {
    const aCurrent = a.isCurrent ? 1 : 0;
    const bCurrent = b.isCurrent ? 1 : 0;
    if (aCurrent !== bCurrent) return bCurrent - aCurrent;
    const aLast = Date.parse(String(a.lastSeenAt || "")) || 0;
    const bLast = Date.parse(String(b.lastSeenAt || "")) || 0;
    return bLast - aLast;
  });
}

function normalizeProviders(input) {
  const out = [];
  const seen = new Set();
  (Array.isArray(input) ? input : []).forEach((value) => {
    const provider = String(value || "").trim().toLowerCase();
    if (!provider || seen.has(provider)) return;
    seen.add(provider);
    out.push(provider);
  });
  return out;
}

function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const userId = DB.emailIndex[normalized];
  if (!userId) return null;
  const user = DB.users[userId];
  if (!user) return null;
  return user;
}

function ensurePasswordResetStore() {
  if (!DB.passwordResetTokens || typeof DB.passwordResetTokens !== "object") {
    DB.passwordResetTokens = {};
  }
  return DB.passwordResetTokens;
}

function hashResetSecret(secret) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(String(secret || "")).digest("base64url");
}

function buildAppUrl(req, pathAndQuery) {
  const pathSafe = String(pathAndQuery || "/").startsWith("/") ? String(pathAndQuery || "/") : `/${pathAndQuery || ""}`;
  if (APP_BASE_URL) {
    try {
      return new URL(pathSafe, APP_BASE_URL).toString();
    } catch {}
  }
  const host = String(req?.headers?.host || "").trim() || `localhost:${PORT}`;
  const protoHeader = String(req?.headers?.["x-forwarded-proto"] || "").trim().toLowerCase();
  const protocol = protoHeader === "https" ? "https" : "http";
  return `${protocol}://${host}${pathSafe}`;
}

function cleanupPasswordResetTokens() {
  const store = ensurePasswordResetStore();
  const ts = now();
  let changed = false;
  Object.entries(store).forEach(([tokenId, entry]) => {
    const expiresAt = Number(entry?.expiresAt || 0);
    const usedAt = Number(entry?.usedAt || 0);
    const shouldDeleteExpired = !Number.isFinite(expiresAt) || expiresAt <= ts;
    const shouldDeleteUsed = Number.isFinite(usedAt) && usedAt > 0 && ts - usedAt > 24 * 60 * 60 * 1000;
    if (shouldDeleteExpired || shouldDeleteUsed) {
      delete store[tokenId];
      changed = true;
    }
  });
  if (changed) saveDatabase();
}

function createPasswordResetTokenForUser(user, req) {
  const store = ensurePasswordResetStore();
  cleanupPasswordResetTokens();

  const activeForUser = Object.values(store)
    .filter((entry) => entry && entry.userId === user.id && Number(entry.expiresAt || 0) > now() && !Number(entry.usedAt || 0))
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  while (activeForUser.length >= PASSWORD_RESET_MAX_ACTIVE_PER_USER) {
    const oldest = activeForUser.shift();
    if (oldest?.id && store[oldest.id]) delete store[oldest.id];
  }

  const tokenId = crypto.randomBytes(12).toString("base64url");
  const secret = crypto.randomBytes(24).toString("base64url");
  const createdAt = now();
  const expiresAt = createdAt + PASSWORD_RESET_TTL_MS;
  store[tokenId] = {
    id: tokenId,
    userId: user.id,
    email: user.email,
    secretHash: hashResetSecret(secret),
    createdAt,
    expiresAt,
    usedAt: 0,
    requestedIp: cleanText(getClientIp(req)).slice(0, 96),
    requestedUa: cleanText(summarizeUserAgent(String(req?.headers?.["user-agent"] || ""))).slice(0, 220)
  };
  saveDatabase();
  return `${tokenId}.${secret}`;
}

function verifyPasswordResetToken(rawToken) {
  const token = String(rawToken || "").trim();
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const tokenId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!tokenId || !secret) return { ok: false, reason: "invalid" };

  const store = ensurePasswordResetStore();
  const entry = store[tokenId];
  if (!entry) return { ok: false, reason: "not_found" };
  if (Number(entry.usedAt || 0) > 0) return { ok: false, reason: "used" };
  if (Number(entry.expiresAt || 0) <= now()) return { ok: false, reason: "expired" };

  const incoming = hashResetSecret(secret);
  const expected = String(entry.secretHash || "");
  const a = Buffer.from(incoming, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "invalid" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };
  return { ok: true, tokenId, entry };
}

function markPasswordResetTokenUsed(tokenId, req) {
  const store = ensurePasswordResetStore();
  const entry = store[String(tokenId || "")];
  if (!entry) return;
  entry.usedAt = now();
  entry.usedIp = cleanText(getClientIp(req)).slice(0, 96);
  entry.usedUa = cleanText(summarizeUserAgent(String(req?.headers?.["user-agent"] || ""))).slice(0, 220);
  store[String(tokenId || "")] = entry;
  saveDatabase();
}

function invalidatePasswordResetTokensForUser(userId, exceptTokenId = "") {
  const uid = String(userId || "");
  if (!uid) return 0;
  const exceptId = String(exceptTokenId || "");
  const store = ensurePasswordResetStore();
  let removed = 0;
  Object.entries(store).forEach(([tokenId, entry]) => {
    if (!entry || String(entry.userId || "") !== uid) return;
    if (exceptId && tokenId === exceptId) return;
    delete store[tokenId];
    removed += 1;
  });
  if (removed > 0) saveDatabase();
  return removed;
}

function revokeAllSessionsByUserId(userId) {
  const uid = String(userId || "");
  let removed = 0;
  for (const [sid, session] of SESSIONS.entries()) {
    if (!session || session.userId !== uid) continue;
    SESSIONS.delete(sid);
    removed += 1;
  }
  if (removed > 0) persistSessionsSoon();
  return removed;
}

async function sendPasswordResetEmail(email, resetUrl, displayName = "") {
  if (!mailTransport) {
    return { sent: false, reason: "smtp_not_configured" };
  }
  const safeEmail = normalizeEmail(email);
  if (!isValidEmail(safeEmail)) return { sent: false, reason: "invalid_email" };

  const name = cleanText(displayName || "Usuario").slice(0, 80) || "Usuario";
  const subject = "Restablece tu contrasena de YumeVerse";
  const text = [
    `Hola ${name},`,
    "",
    "Recibimos una solicitud para restablecer tu contrasena.",
    "Si fuiste tu, abre este enlace:",
    resetUrl,
    "",
    "El enlace expira en 30 minutos.",
    "Si no solicitaste este cambio, ignora este mensaje."
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1b1b1b">
      <p>Hola <strong>${escHtml(name)}</strong>,</p>
      <p>Recibimos una solicitud para restablecer tu contrasena.</p>
      <p>
        <a href="${escHtml(resetUrl)}" style="display:inline-block;padding:10px 14px;background:#ff6a1b;color:#fff;border-radius:8px;text-decoration:none;">
          Restablecer contrasena
        </a>
      </p>
      <p style="font-size:13px;color:#555">El enlace expira en 30 minutos.</p>
      <p style="font-size:13px;color:#555">Si no solicitaste este cambio, ignora este mensaje.</p>
    </div>
  `;

  await mailTransport.sendMail({
    from: SMTP_FROM,
    to: safeEmail,
    subject,
    text,
    html
  });
  return { sent: true };
}

function escHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureEmailVerifyStore() {
  if (!DB.emailVerifyTokens || typeof DB.emailVerifyTokens !== "object") {
    DB.emailVerifyTokens = {};
  }
  return DB.emailVerifyTokens;
}

function cleanupEmailVerifyTokens() {
  const store = ensureEmailVerifyStore();
  const ts = now();
  let changed = false;
  Object.entries(store).forEach(([tokenId, entry]) => {
    const expiresAt = Number(entry?.expiresAt || 0);
    const usedAt = Number(entry?.usedAt || 0);
    const shouldDeleteExpired = !Number.isFinite(expiresAt) || expiresAt <= ts;
    const shouldDeleteUsed = Number.isFinite(usedAt) && usedAt > 0 && ts - usedAt > 14 * 24 * 60 * 60 * 1000;
    if (shouldDeleteExpired || shouldDeleteUsed) {
      delete store[tokenId];
      changed = true;
    }
  });
  if (changed) saveDatabase();
}

function createEmailVerifyTokenForUser(user, req) {
  const store = ensureEmailVerifyStore();
  cleanupEmailVerifyTokens();

  const activeForUser = Object.values(store)
    .filter((entry) => entry && entry.userId === user.id && Number(entry.expiresAt || 0) > now() && !Number(entry.usedAt || 0))
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  while (activeForUser.length >= EMAIL_VERIFY_MAX_ACTIVE_PER_USER) {
    const oldest = activeForUser.shift();
    if (oldest?.id && store[oldest.id]) delete store[oldest.id];
  }

  const tokenId = crypto.randomBytes(12).toString("base64url");
  const secret = crypto.randomBytes(24).toString("base64url");
  const createdAt = now();
  const expiresAt = createdAt + EMAIL_VERIFY_TTL_MS;

  store[tokenId] = {
    id: tokenId,
    userId: user.id,
    email: user.email,
    secretHash: hashResetSecret(secret),
    createdAt,
    expiresAt,
    usedAt: 0,
    requestedIp: cleanText(getClientIp(req)).slice(0, 96),
    requestedUa: cleanText(summarizeUserAgent(String(req?.headers?.["user-agent"] || ""))).slice(0, 220)
  };
  saveDatabase();
  return `${tokenId}.${secret}`;
}

function verifyEmailToken(rawToken) {
  const token = String(rawToken || "").trim();
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const tokenId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!tokenId || !secret) return { ok: false, reason: "invalid" };

  const store = ensureEmailVerifyStore();
  const entry = store[tokenId];
  if (!entry) return { ok: false, reason: "not_found" };
  if (Number(entry.usedAt || 0) > 0) return { ok: false, reason: "used" };
  if (Number(entry.expiresAt || 0) <= now()) return { ok: false, reason: "expired" };

  const incoming = hashResetSecret(secret);
  const expected = String(entry.secretHash || "");
  const a = Buffer.from(incoming, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "invalid" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };
  return { ok: true, tokenId, entry };
}

function markEmailVerifyTokenUsed(tokenId, req) {
  const store = ensureEmailVerifyStore();
  const entry = store[String(tokenId || "")];
  if (!entry) return;
  entry.usedAt = now();
  entry.usedIp = cleanText(getClientIp(req)).slice(0, 96);
  entry.usedUa = cleanText(summarizeUserAgent(String(req?.headers?.["user-agent"] || ""))).slice(0, 220);
  store[String(tokenId || "")] = entry;
  saveDatabase();
}

function invalidateEmailVerifyTokensForUser(userId, exceptTokenId = "") {
  const uid = String(userId || "");
  if (!uid) return 0;
  const exceptId = String(exceptTokenId || "");
  const store = ensureEmailVerifyStore();
  let removed = 0;
  Object.entries(store).forEach(([tokenId, entry]) => {
    if (!entry || String(entry.userId || "") !== uid) return;
    if (exceptId && tokenId === exceptId) return;
    delete store[tokenId];
    removed += 1;
  });
  if (removed > 0) saveDatabase();
  return removed;
}

async function sendEmailVerificationEmail(email, verifyUrl, displayName = "") {
  if (!mailTransport) {
    return { sent: false, reason: "smtp_not_configured" };
  }
  const safeEmail = normalizeEmail(email);
  if (!isValidEmail(safeEmail)) return { sent: false, reason: "invalid_email" };

  const name = cleanText(displayName || "Usuario").slice(0, 80) || "Usuario";
  const subject = "Confirma tu correo en YumeVerse";
  const text = [
    `Hola ${name},`,
    "",
    "Para activar tu cuenta local, confirma tu correo:",
    verifyUrl,
    "",
    "El enlace expira en 24 horas.",
    "Si no creaste esta cuenta, ignora este mensaje."
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1b1b1b">
      <p>Hola <strong>${escHtml(name)}</strong>,</p>
      <p>Para activar tu cuenta local, confirma tu correo:</p>
      <p>
        <a href="${escHtml(verifyUrl)}" style="display:inline-block;padding:10px 14px;background:#ff6a1b;color:#fff;border-radius:8px;text-decoration:none;">
          Verificar correo
        </a>
      </p>
      <p style="font-size:13px;color:#555">El enlace expira en 24 horas.</p>
      <p style="font-size:13px;color:#555">Si no creaste esta cuenta, ignora este mensaje.</p>
    </div>
  `;

  await mailTransport.sendMail({
    from: SMTP_FROM,
    to: safeEmail,
    subject,
    text,
    html
  });
  return { sent: true };
}

async function sendOrLogEmailVerification(user, req) {
  const token = createEmailVerifyTokenForUser(user, req);
  const verifyUrl = buildAppUrl(req, `/verify-email.html?token=${encodeURIComponent(token)}`);
  const sent = await sendEmailVerificationEmail(user.email, verifyUrl, user.name || "Usuario");
  if (!sent.sent || process.env.NODE_ENV !== "production") {
    console.log(`[email-verify] ${user.email} -> ${verifyUrl}`);
  }
  return { sent: sent.sent, verifyUrl };
}

function upsertLocalUser({ email, password, name }) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new Error("Correo invalido");
  }

  const safePassword = String(password || "");
  const policy = validatePasswordStrength(safePassword, "La contrasena");
  if (!policy.ok) {
    throw new Error(policy.error);
  }

  const displayName = normalizeDisplayName(name || normalizedEmail.split("@")[0]);
  const existing = findUserByEmail(normalizedEmail);
  const userId = existing?.id || `u_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const createdAt = existing?.createdAt || nowIso();
  const passwordPack = hashPassword(safePassword);
  const providers = normalizeProviders([...(existing?.authProviders || []), "local"]);
  const verifiedByGoogle = Boolean(existing?.googleSub && cleanText(existing?.email || "").toLowerCase() === normalizedEmail);
  const alreadyVerified = Boolean(cleanText(existing?.emailVerifiedAt || "").slice(0, 48));
  const emailVerificationPending = !(verifiedByGoogle || alreadyVerified);

  const user = {
    ...(existing || {}),
    id: userId,
    email: normalizedEmail,
    name: displayName,
    createdAt,
    lastLoginAt: nowIso(),
    authProviders: providers,
    localAuth: {
      salt: passwordPack.salt,
      hash: passwordPack.hash,
      updatedAt: nowIso()
    },
    emailVerificationPending,
    emailVerifiedAt: emailVerificationPending ? "" : cleanText(existing?.emailVerifiedAt || nowIso()).slice(0, 48)
  };

  if (!user.picture) user.picture = "";
  DB.users[userId] = user;
  DB.emailIndex[normalizedEmail] = userId;
  ensureProfile(userId);
  saveDatabase();
  return user;
}

function loginLocalUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const user = findUserByEmail(normalizedEmail);
  if (!user || !user.localAuth?.salt || !user.localAuth?.hash) {
    throw new Error("No existe una cuenta local con ese correo");
  }

  const ok = verifyPassword(password, user.localAuth.salt, user.localAuth.hash);
  if (!ok) throw new Error("Correo o contrasena incorrectos");
  if (user.emailVerificationPending === true) {
    const err = new Error("Debes verificar tu correo antes de iniciar sesion");
    err.code = "EMAIL_NOT_VERIFIED";
    throw err;
  }

  user.lastLoginAt = nowIso();
  user.authProviders = normalizeProviders([...(user.authProviders || []), "local"]);
  DB.users[user.id] = user;
  saveDatabase();
  return user;
}

function setOrUpdateLocalPassword(user, nextPassword) {
  const safePassword = String(nextPassword || "");
  const policy = validatePasswordStrength(safePassword, "La contrasena");
  if (!policy.ok) {
    throw new Error(policy.error);
  }
  const pack = hashPassword(safePassword);
  user.localAuth = {
    salt: pack.salt,
    hash: pack.hash,
    updatedAt: nowIso()
  };
  user.authProviders = normalizeProviders([...(user.authProviders || []), "local"]);
  if (user.emailVerificationPending !== true && !cleanText(user.emailVerifiedAt || "").slice(0, 48)) {
    user.emailVerifiedAt = nowIso();
  }
  DB.users[user.id] = user;
  saveDatabase();
  return user;
}

function upsertGoogleUser(payload, hints = {}) {
  const googleSub = String(payload?.sub || "").trim();
  const email = normalizeEmail(payload?.email || "");
  const hintName = normalizeDisplayName(hints?.name || "");
  const displayName = normalizeDisplayName(payload?.name || hintName || email.split("@")[0] || "Usuario");
  const hintedPicture = normalizeGooglePicture(hints?.picture || "");
  const payloadPicture = normalizeGooglePicture(payload?.picture || "");

  if (!googleSub || !email) {
    throw new Error("Payload Google invalido");
  }

  const existingByGoogle = DB.googleIndex[googleSub];
  const existingByEmail = DB.emailIndex[email];
  const userId = existingByGoogle || existingByEmail || `u_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const previous = DB.users[userId] || null;
  const createdAt = previous?.createdAt || nowIso();
  const providers = normalizeProviders([...(previous?.authProviders || []), "google", previous?.localAuth ? "local" : ""]);
  const previousPicture = cleanUrl(previous?.picture || "");
  const picture = payloadPicture || hintedPicture || previousPicture || "";

  const user = {
    ...(previous || {}),
    id: userId,
    googleSub,
    email,
    name: displayName,
    picture,
    createdAt,
    lastLoginAt: nowIso(),
    authProviders: providers,
    emailVerificationPending: false,
    emailVerifiedAt: cleanText(previous?.emailVerifiedAt || nowIso()).slice(0, 48)
  };

  DB.users[userId] = user;
  DB.googleIndex[googleSub] = userId;
  DB.emailIndex[email] = userId;
  ensureProfile(userId);
  saveDatabase();
  return user;
}

async function mapLimit(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const safeLimit = Math.max(1, Math.min(limit || 1, list.length || 1));
  const results = new Array(list.length);
  let idx = 0;

  const workers = Array.from({ length: safeLimit }, async () => {
    while (idx < list.length) {
      const current = idx++;
      try {
        results[current] = await mapper(list[current], current);
      } catch {
        results[current] = null;
      }
    }
  });

  await Promise.all(workers);
  return results;
}

function looksSpanish(text) {
  const sample = cleanText(text).toLowerCase();
  if (!sample) return false;
  if (/[\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]/.test(sample)) return true;
  const tokens = sample.match(/[a-z]+/g) || [];
  const markers = new Set(["los", "las", "una", "uno", "para", "del", "como", "pero", "sus", "esta", "este", "entre", "sobre", "tambien", "despues", "porque", "desde"]);
  let hits = 0;
  for (const token of tokens) {
    if (markers.has(token)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

function chunkText(text, maxLen = 420) {
  const source = cleanText(text);
  if (!source) return [];
  const parts = source.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";
  for (const part of parts) {
    if (!part) continue;
    if ((current + " " + part).trim().length <= maxLen) {
      current = `${current} ${part}`.trim();
      continue;
    }
    if (current) chunks.push(current);
    if (part.length <= maxLen) {
      current = part;
      continue;
    }
    for (let i = 0; i < part.length; i += maxLen) {
      chunks.push(part.slice(i, i + maxLen));
    }
    current = "";
  }
  if (current) chunks.push(current);
  return chunks;
}

async function translateChunkToSpanish(chunk) {
  const mmUrl = new URL(TRANSLATE_URL);
  mmUrl.searchParams.set("q", chunk);
  mmUrl.searchParams.set("langpair", "en|es");
  const mm = await fetchJson(mmUrl.toString(), { headers: { Accept: "application/json" } });
  if (mm.ok) {
    const translated = cleanText(mm.json?.responseData?.translatedText || "");
    if (translated && !/QUERY LENGTH LIMIT EXCEEDED/i.test(translated) && translated !== cleanText(chunk)) {
      return translated;
    }
  }

  const gUrl = new URL(GOOGLE_TRANSLATE_URL);
  gUrl.searchParams.set("client", "gtx");
  gUrl.searchParams.set("sl", "en");
  gUrl.searchParams.set("tl", "es");
  gUrl.searchParams.set("dt", "t");
  gUrl.searchParams.set("q", chunk);
  const g = await fetchJson(gUrl.toString(), { headers: { Accept: "application/json" } });
  if (!g.ok) throw new Error(`Translate ${g.status}`);
  const segments = Array.isArray(g.json?.[0]) ? g.json[0] : [];
  const fromGoogle = cleanText(segments.map((row) => row?.[0] || "").join(" "));
  if (!fromGoogle) throw new Error("Translate empty");
  return fromGoogle;
}

async function translateTextToSpanish(text) {
  const source = cleanText(text);
  if (!source) return "";
  if (looksSpanish(source)) return source;

  const chunks = chunkText(source);
  if (!chunks.length) return source;

  const out = [];
  for (const chunk of chunks) {
    try {
      const translated = await translateChunkToSpanish(chunk);
      out.push(translated || chunk);
      continue;
    } catch {}

    const miniChunks = chunkText(chunk, 160);
    if (!miniChunks.length) {
      out.push(chunk);
      continue;
    }
    for (const mini of miniChunks) {
      try {
        const translatedMini = await translateChunkToSpanish(mini);
        out.push(translatedMini || mini);
      } catch {
        out.push(mini);
      }
    }
  }
  return cleanText(out.join(" "));
}

async function fetchJikanSynopsis(idMal) {
  if (!idMal) return "";
  const url = `${JIKAN_URL}/anime/${encodeURIComponent(idMal)}/full`;
  const upstream = await fetchJson(url, { headers: { Accept: "application/json" } });
  if (!upstream.ok) return "";
  return cleanText(upstream.json?.data?.synopsis || "");
}

async function fetchKitsuSynopsisByTitle(title) {
  const q = cleanText(title);
  if (!q) return "";
  const url = new URL(`${KITSU_URL}/anime`);
  url.searchParams.set("filter[text]", q);
  url.searchParams.set("page[limit]", "1");
  const upstream = await fetchJson(url.toString(), { headers: { Accept: "application/vnd.api+json" } });
  if (!upstream.ok) return "";
  const first = upstream.json?.data?.[0];
  return cleanText(first?.attributes?.synopsis || first?.attributes?.description || "");
}

function buildJikanImagePayload(idMal, data) {
  const webp = data?.images?.webp || {};
  const jpg = data?.images?.jpg || {};
  const trailer = data?.trailer?.images || {};
  const cover =
    webp.large_image_url ||
    jpg.large_image_url ||
    webp.image_url ||
    jpg.image_url ||
    "";
  const banner =
    trailer.maximum_image_url ||
    trailer.large_image_url ||
    trailer.medium_image_url ||
    webp.large_image_url ||
    jpg.large_image_url ||
    cover;
  const thumb = webp.image_url || jpg.image_url || cover;
  const qualityScore = Number(
    (trailer.maximum_image_url ? 3 : 0) +
      (webp.large_image_url ? 2 : 0) +
      (jpg.large_image_url ? 1 : 0)
  );

  return {
    idMal,
    cover: cleanUrl(cover),
    banner: cleanUrl(banner),
    thumb: cleanUrl(thumb),
    qualityScore,
    source: "jikan"
  };
}

async function getBestImagesByMalId(idMal) {
  const cacheKey = `imageq:v3:${idMal}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const fullUrl = `${JIKAN_URL}/anime/${encodeURIComponent(idMal)}/full`;
  const upstream = await fetchJson(fullUrl, { headers: { Accept: "application/json" } });
  if (!upstream.ok || !upstream.json?.data) {
    const payload = { idMal, cover: "", banner: "", thumb: "", qualityScore: 0, source: "none" };
    cacheSet(cacheKey, payload, 12 * 60 * 60_000);
    return payload;
  }

  const payload = buildJikanImagePayload(idMal, upstream.json.data);
  cacheSet(cacheKey, payload, 15 * 24 * 60 * 60_000);
  return payload;
}

async function handleConfig(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }
  sendJson(res, 200, {
    googleAuthEnabled: Boolean(GOOGLE_CLIENT_ID),
    googleClientId: GOOGLE_CLIENT_ID || "",
    localAuthEnabled: true,
    passwordMinLen: PASSWORD_MIN_LEN,
    passwordRequiresLetter: PASSWORD_REQUIRE_LETTER,
    passwordRequiresNumber: PASSWORD_REQUIRE_NUMBER,
    passwordPolicyMessage: getPasswordPolicyMessage("La contrasena"),
    passwordResetEnabled: isPasswordResetAvailable(),
    emailVerificationEnabled: true
  });
}

async function handleAuthSession(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const auth = getAuthContext(req);
  if (!auth) {
    sendJson(res, 200, { authenticated: false });
    return;
  }

  const profile = ensureProfile(auth.user.id);
  sendJson(res, 200, {
    authenticated: true,
    user: publicUser(auth.user),
    stats: profileStats(profile)
  });
}

async function handleAuthGoogle(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const gate = checkAuthRateLimit(req, "google");
  if (!gate.allowed) {
    writeSecurityEvent("auth_google_rate_limited", req, { retryAfterSec: gate.retryAfterSec });
    sendRateLimited(res, gate.retryAfterSec);
    return;
  }

  if (!googleClient || !GOOGLE_CLIENT_ID) {
    writeSecurityEvent("auth_google_unavailable", req, {});
    sendJson(res, 503, { error: "Google Auth no configurado. Define GOOGLE_CLIENT_ID." });
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;
  const credential = String(body?.credential || "").trim();
  if (!credential) {
    registerAuthFailure(req, "google");
    writeSecurityEvent("auth_google_failed", req, { reason: "missing_credential" });
    sendJson(res, 400, { error: "Falta credential" });
    return;
  }

  try {
    const decodedPayload = decodeJwtPayload(credential);
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload() || {};

    if (!payload.sub || !payload.email) {
      registerAuthFailure(req, "google");
      writeSecurityEvent("auth_google_failed", req, { reason: "invalid_payload" });
      sendJson(res, 401, { error: "Token Google invalido" });
      return;
    }

    if (payload.email_verified === false) {
      registerAuthFailure(req, "google");
      writeSecurityEvent("auth_google_failed", req, { reason: "email_not_verified" });
      sendJson(res, 401, { error: "Correo Google no verificado" });
      return;
    }

    const user = upsertGoogleUser(payload, {
      name: decodedPayload?.name || payload?.name || "",
      picture: decodedPayload?.picture || payload?.picture || ""
    });
    const sessionId = createSession(user.id, req);
    setSessionCookie(res, sessionId);
    registerAuthSuccess(req, "google");
    writeSecurityEvent("auth_google_success", req, { userId: user.id, email: securityValue(user.email, 120) });

    const profile = ensureProfile(user.id);
    sendJson(res, 200, {
      authenticated: true,
      user: publicUser(user),
      stats: profileStats(profile)
    });
  } catch (error) {
    registerAuthFailure(req, "google");
    writeSecurityEvent("auth_google_failed", req, { reason: "verify_exception" });
    sendJson(res, 401, { error: "No se pudo verificar la cuenta de Google", details: String(error.message || error) });
  }
}

async function handleAuthRegister(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;

  const email = normalizeEmail(body?.email || "");
  const password = String(body?.password || "");
  const name = normalizeDisplayName(body?.name || email.split("@")[0] || "Usuario");

  const gateIp = checkAuthRateLimit(req, "register");
  const gateEmail = email ? checkAuthRateLimit(req, "register", email) : { allowed: true, retryAfterSec: 0 };
  const blockedRetry = Math.max(gateIp.retryAfterSec || 0, gateEmail.retryAfterSec || 0);
  if (!gateIp.allowed || !gateEmail.allowed) {
    writeSecurityEvent("auth_register_rate_limited", req, { email: securityValue(email, 120), retryAfterSec: blockedRetry || 1 });
    sendRateLimited(res, blockedRetry || 1);
    return;
  }

  if (!isValidEmail(email)) {
    registerAuthFailure(req, "register");
    writeSecurityEvent("auth_register_failed", req, { reason: "invalid_email", email: securityValue(email, 120) });
    sendJson(res, 400, { error: "Correo invalido" });
    return;
  }
  const passwordPolicy = validatePasswordStrength(password, "La contrasena");
  if (!passwordPolicy.ok) {
    registerAuthFailure(req, "register");
    registerAuthFailure(req, "register", email);
    writeSecurityEvent("auth_register_failed", req, {
      reason: passwordPolicy.reason || "weak_password",
      email: securityValue(email, 120)
    });
    sendJson(res, 400, { error: passwordPolicy.error || getPasswordPolicyMessage("La contrasena") });
    return;
  }

  try {
    const user = upsertLocalUser({ email, password, name });
    registerAuthSuccess(req, "register");
    registerAuthSuccess(req, "register", email);
    if (user.emailVerificationPending === true) {
      await sendOrLogEmailVerification(user, req);
      writeSecurityEvent("auth_register_verification_required", req, {
        userId: user.id,
        email: securityValue(user.email, 120)
      });
      clearSessionCookie(res);
      sendJson(res, 200, {
        authenticated: false,
        requiresEmailVerification: true,
        message: "Cuenta creada. Revisa tu correo para verificar y activar el acceso."
      });
      return;
    }

    const sessionId = createSession(user.id, req);
    setSessionCookie(res, sessionId);
    writeSecurityEvent("auth_register_success", req, {
      userId: user.id,
      email: securityValue(user.email, 120)
    });
    const profile = ensureProfile(user.id);
    sendJson(res, 200, {
      authenticated: true,
      user: publicUser(user),
      stats: profileStats(profile)
    });
  } catch (error) {
    registerAuthFailure(req, "register");
    registerAuthFailure(req, "register", email);
    writeSecurityEvent("auth_register_failed", req, { reason: "exception", email: securityValue(email, 120) });
    sendJson(res, 400, { error: String(error.message || error) });
  }
}

async function handleAuthLogin(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;

  const email = normalizeEmail(body?.email || "");
  const password = String(body?.password || "");

  const gateIp = checkAuthRateLimit(req, "login");
  const gateEmail = email ? checkAuthRateLimit(req, "login", email) : { allowed: true, retryAfterSec: 0 };
  const blockedRetry = Math.max(gateIp.retryAfterSec || 0, gateEmail.retryAfterSec || 0);
  if (!gateIp.allowed || !gateEmail.allowed) {
    writeSecurityEvent("auth_login_rate_limited", req, { email: securityValue(email, 120), retryAfterSec: blockedRetry || 1 });
    sendRateLimited(res, blockedRetry || 1);
    return;
  }

  if (!isValidEmail(email)) {
    registerAuthFailure(req, "login");
    writeSecurityEvent("auth_login_failed", req, { reason: "invalid_email", email: securityValue(email, 120) });
    sendJson(res, 400, { error: "Correo invalido" });
    return;
  }
  if (!password) {
    registerAuthFailure(req, "login");
    registerAuthFailure(req, "login", email);
    writeSecurityEvent("auth_login_failed", req, { reason: "missing_password", email: securityValue(email, 120) });
    sendJson(res, 400, { error: "Falta contrasena" });
    return;
  }

  try {
    const user = loginLocalUser({ email, password });
    const sessionId = createSession(user.id, req);
    setSessionCookie(res, sessionId);
    registerAuthSuccess(req, "login");
    registerAuthSuccess(req, "login", email);
    writeSecurityEvent("auth_login_success", req, { userId: user.id, email: securityValue(user.email, 120) });
    const profile = ensureProfile(user.id);
    sendJson(res, 200, {
      authenticated: true,
      user: publicUser(user),
      stats: profileStats(profile)
    });
  } catch (error) {
    registerAuthFailure(req, "login");
    registerAuthFailure(req, "login", email);
    writeSecurityEvent("auth_login_failed", req, {
      reason: error && error.code === "EMAIL_NOT_VERIFIED" ? "email_not_verified" : "invalid_credentials",
      email: securityValue(email, 120)
    });
    if (error && error.code === "EMAIL_NOT_VERIFIED") {
      sendJson(res, 403, {
        error: String(error.message || "Debes verificar tu correo antes de iniciar sesion"),
        needsEmailVerification: true
      });
      return;
    }
    sendJson(res, 401, { error: String(error.message || error) });
  }
}

async function handleAuthLogout(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }
  const session = getSessionFromRequest(req);
  if (session?.sessionId) {
    SESSIONS.delete(session.sessionId);
    persistSessionsSoon();
    writeSecurityEvent("auth_logout", req, { userId: session.userId || "", sessionId: session.sessionId });
  }
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

async function handleAuthEmailResend(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;
  const auth = getAuthContext(req);
  const emailFromBody = normalizeEmail(body?.email || "");
  const email = emailFromBody || normalizeEmail(auth?.user?.email || "");
  const genericMessage = "Si la cuenta existe y esta pendiente, enviaremos un nuevo enlace de verificacion.";

  const gateIp = checkAuthRateLimit(req, "email_resend");
  const gateEmail = email ? checkAuthRateLimit(req, "email_resend", email) : { allowed: true, retryAfterSec: 0 };
  const blockedRetry = Math.max(gateIp.retryAfterSec || 0, gateEmail.retryAfterSec || 0);
  if (!gateIp.allowed || !gateEmail.allowed) {
    writeSecurityEvent("auth_email_resend_rate_limited", req, {
      email: securityValue(email, 120),
      retryAfterSec: blockedRetry || 1
    });
    sendRateLimited(res, blockedRetry || 1);
    return;
  }

  if (!isValidEmail(email)) {
    registerAuthFailure(req, "email_resend");
    writeSecurityEvent("auth_email_resend_failed", req, { reason: "invalid_email", email: securityValue(email, 120) });
    sendJson(res, 200, { ok: true, message: genericMessage });
    return;
  }

  const user = findUserByEmail(email);
  if (!user || !user.localAuth?.salt || !user.localAuth?.hash || user.emailVerificationPending !== true) {
    registerAuthFailure(req, "email_resend");
    registerAuthFailure(req, "email_resend", email);
    writeSecurityEvent("auth_email_resend_ignored", req, { email: securityValue(email, 120) });
    sendJson(res, 200, { ok: true, message: genericMessage });
    return;
  }

  try {
    await sendOrLogEmailVerification(user, req);
    registerAuthSuccess(req, "email_resend");
    registerAuthSuccess(req, "email_resend", email);
    writeSecurityEvent("auth_email_resend_success", req, { userId: user.id, email: securityValue(email, 120) });
    sendJson(res, 200, { ok: true, message: genericMessage });
  } catch {
    registerAuthFailure(req, "email_resend");
    registerAuthFailure(req, "email_resend", email);
    writeSecurityEvent("auth_email_resend_failed", req, { reason: "send_error", email: securityValue(email, 120) });
    sendJson(res, 200, { ok: true, message: genericMessage });
  }
}

async function handleAuthEmailVerify(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const gateIp = checkAuthRateLimit(req, "email_verify");
  if (!gateIp.allowed) {
    writeSecurityEvent("auth_email_verify_rate_limited", req, { retryAfterSec: gateIp.retryAfterSec });
    sendRateLimited(res, gateIp.retryAfterSec);
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;
  const token = String(body?.token || "").trim();
  if (!token) {
    registerAuthFailure(req, "email_verify");
    writeSecurityEvent("auth_email_verify_failed", req, { reason: "missing_token" });
    sendJson(res, 400, { error: "Falta token de verificacion" });
    return;
  }

  cleanupEmailVerifyTokens();
  const checked = verifyEmailToken(token);
  if (!checked.ok) {
    registerAuthFailure(req, "email_verify");
    writeSecurityEvent("auth_email_verify_failed", req, { reason: "invalid_token" });
    sendJson(res, 400, { error: "Token de verificacion invalido o expirado" });
    return;
  }

  const user = DB.users[String(checked.entry.userId || "")];
  if (!user) {
    registerAuthFailure(req, "email_verify");
    writeSecurityEvent("auth_email_verify_failed", req, { reason: "user_not_found" });
    sendJson(res, 404, { error: "Usuario no encontrado" });
    return;
  }
  const expectedEmail = normalizeEmail(checked.entry.email || "");
  if (!expectedEmail || normalizeEmail(user.email || "") !== expectedEmail) {
    registerAuthFailure(req, "email_verify");
    writeSecurityEvent("auth_email_verify_failed", req, { reason: "email_mismatch", userId: user.id });
    sendJson(res, 400, { error: "Token de verificacion no coincide con la cuenta" });
    return;
  }

  user.emailVerificationPending = false;
  if (!cleanText(user.emailVerifiedAt || "").slice(0, 48)) {
    user.emailVerifiedAt = nowIso();
  }
  user.authProviders = normalizeProviders([...(user.authProviders || []), "local"]);
  DB.users[user.id] = user;
  saveDatabase();

  markEmailVerifyTokenUsed(checked.tokenId, req);
  invalidateEmailVerifyTokensForUser(user.id, checked.tokenId);
  registerAuthSuccess(req, "email_verify");
  const sessionId = createSession(user.id, req);
  setSessionCookie(res, sessionId);
  const profile = ensureProfile(user.id);
  writeSecurityEvent("auth_email_verify_success", req, {
    userId: user.id,
    email: securityValue(user.email, 120)
  });

  sendJson(res, 200, {
    ok: true,
    authenticated: true,
    user: publicUser(user),
    stats: profileStats(profile),
    message: "Correo verificado correctamente"
  });
}

async function handleAuthPasswordForgot(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  if (!isPasswordResetAvailable()) {
    writeSecurityEvent("auth_password_forgot_unavailable", req, {});
    sendJson(res, 503, { error: "Recuperacion de contrasena no disponible en este servidor" });
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;
  const email = normalizeEmail(body?.email || "");
  const genericMessage = "Si el correo existe, enviaremos un enlace para restablecer la contrasena.";

  const gateIp = checkAuthRateLimit(req, "password_forgot");
  const gateEmail = email ? checkAuthRateLimit(req, "password_forgot", email) : { allowed: true, retryAfterSec: 0 };
  const blockedRetry = Math.max(gateIp.retryAfterSec || 0, gateEmail.retryAfterSec || 0);
  if (!gateIp.allowed || !gateEmail.allowed) {
    writeSecurityEvent("auth_password_forgot_rate_limited", req, {
      email: securityValue(email, 120),
      retryAfterSec: blockedRetry || 1
    });
    sendRateLimited(res, blockedRetry || 1);
    return;
  }

  if (!isValidEmail(email)) {
    registerAuthFailure(req, "password_forgot");
    writeSecurityEvent("auth_password_forgot_failed", req, { reason: "invalid_email", email: securityValue(email, 120) });
    sendJson(res, 200, { ok: true, message: genericMessage });
    return;
  }

  const user = findUserByEmail(email);
  if (!user) {
    registerAuthFailure(req, "password_forgot");
    registerAuthFailure(req, "password_forgot", email);
    writeSecurityEvent("auth_password_forgot_ignored", req, { email: securityValue(email, 120) });
    sendJson(res, 200, { ok: true, message: genericMessage });
    return;
  }

  try {
    const token = createPasswordResetTokenForUser(user, req);
    const resetUrl = buildAppUrl(req, `/reset-password.html?token=${encodeURIComponent(token)}`);
    const sent = await sendPasswordResetEmail(user.email, resetUrl, user.name || "Usuario");

    if (!sent.sent || process.env.NODE_ENV !== "production") {
      console.log(`[password-reset] ${user.email} -> ${resetUrl}`);
    }
    registerAuthSuccess(req, "password_forgot");
    registerAuthSuccess(req, "password_forgot", email);
    writeSecurityEvent("auth_password_forgot_success", req, { userId: user.id, email: securityValue(user.email, 120) });
    sendJson(res, 200, {
      ok: true,
      message: genericMessage
    });
  } catch (error) {
    registerAuthFailure(req, "password_forgot");
    registerAuthFailure(req, "password_forgot", email);
    writeSecurityEvent("auth_password_forgot_failed", req, { reason: "send_error", email: securityValue(email, 120) });
    sendJson(res, 200, { ok: true, message: genericMessage });
  }
}

async function handleAuthPasswordReset(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const gateIp = checkAuthRateLimit(req, "password_reset");
  if (!gateIp.allowed) {
    writeSecurityEvent("auth_password_reset_rate_limited", req, { retryAfterSec: gateIp.retryAfterSec });
    sendRateLimited(res, gateIp.retryAfterSec);
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;
  const token = String(body?.token || "").trim();
  const newPassword = String(body?.newPassword || "");

  if (!token) {
    registerAuthFailure(req, "password_reset");
    writeSecurityEvent("auth_password_reset_failed", req, { reason: "missing_token" });
    sendJson(res, 400, { error: "Falta token de restablecimiento" });
    return;
  }
  const resetPolicy = validatePasswordStrength(newPassword, "La contrasena");
  if (!resetPolicy.ok) {
    registerAuthFailure(req, "password_reset");
    writeSecurityEvent("auth_password_reset_failed", req, { reason: resetPolicy.reason || "weak_password" });
    sendJson(res, 400, { error: resetPolicy.error || getPasswordPolicyMessage("La contrasena") });
    return;
  }

  cleanupPasswordResetTokens();
  const checked = verifyPasswordResetToken(token);
  if (!checked.ok) {
    registerAuthFailure(req, "password_reset");
    writeSecurityEvent("auth_password_reset_failed", req, { reason: "invalid_token" });
    sendJson(res, 400, { error: "Token invalido o expirado" });
    return;
  }

  const user = DB.users[String(checked.entry.userId || "")];
  if (!user) {
    registerAuthFailure(req, "password_reset");
    writeSecurityEvent("auth_password_reset_failed", req, { reason: "user_not_found" });
    sendJson(res, 404, { error: "Usuario no encontrado" });
    return;
  }

  setOrUpdateLocalPassword(user, newPassword);
  user.emailVerificationPending = false;
  if (!cleanText(user.emailVerifiedAt || "").slice(0, 48)) {
    user.emailVerifiedAt = nowIso();
  }
  DB.users[user.id] = user;
  saveDatabase();
  markPasswordResetTokenUsed(checked.tokenId, req);
  invalidatePasswordResetTokensForUser(user.id, checked.tokenId);
  invalidateEmailVerifyTokensForUser(user.id);
  revokeAllSessionsByUserId(user.id);
  const sessionId = createSession(user.id, req);
  setSessionCookie(res, sessionId);
  registerAuthSuccess(req, "password_reset");
  writeSecurityEvent("auth_password_reset_success", req, {
    userId: user.id,
    email: securityValue(user.email, 120)
  });

  const profile = ensureProfile(user.id);
  sendJson(res, 200, {
    ok: true,
    authenticated: true,
    user: publicUser(user),
    stats: profileStats(profile)
  });
}

async function handleAuthPasswordChange(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  const gateIp = checkAuthRateLimit(req, "password");
  const gateUser = checkAuthRateLimit(req, "password", auth.user.id);
  const blockedRetry = Math.max(gateIp.retryAfterSec || 0, gateUser.retryAfterSec || 0);
  if (!gateIp.allowed || !gateUser.allowed) {
    writeSecurityEvent("auth_password_change_rate_limited", req, {
      userId: auth.user.id,
      retryAfterSec: blockedRetry || 1
    });
    sendRateLimited(res, blockedRetry || 1);
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;

  const currentPassword = String(body?.currentPassword || "");
  const newPassword = String(body?.newPassword || "");

  const changePolicy = validatePasswordStrength(newPassword, "La contrasena nueva");
  if (!changePolicy.ok) {
    registerAuthFailure(req, "password");
    registerAuthFailure(req, "password", auth.user.id);
    writeSecurityEvent("auth_password_change_failed", req, {
      reason: changePolicy.reason || "weak_password",
      userId: auth.user.id
    });
    sendJson(res, 400, { error: changePolicy.error || getPasswordPolicyMessage("La contrasena nueva") });
    return;
  }
  if (currentPassword && currentPassword === newPassword) {
    registerAuthFailure(req, "password");
    registerAuthFailure(req, "password", auth.user.id);
    writeSecurityEvent("auth_password_change_failed", req, { reason: "same_password", userId: auth.user.id });
    sendJson(res, 400, { error: "La contrasena nueva debe ser diferente de la actual" });
    return;
  }

  const user = DB.users[auth.user.id];
  if (!user) {
    registerAuthFailure(req, "password");
    registerAuthFailure(req, "password", auth.user.id);
    writeSecurityEvent("auth_password_change_failed", req, { reason: "user_not_found", userId: auth.user.id });
    sendJson(res, 404, { error: "Usuario no encontrado" });
    return;
  }

  const hasLocal = Boolean(user.localAuth?.salt && user.localAuth?.hash);
  if (hasLocal) {
    if (!currentPassword) {
      registerAuthFailure(req, "password");
      registerAuthFailure(req, "password", auth.user.id);
      writeSecurityEvent("auth_password_change_failed", req, { reason: "missing_current", userId: auth.user.id });
      sendJson(res, 400, { error: "Falta contrasena actual" });
      return;
    }
    const ok = verifyPassword(currentPassword, user.localAuth.salt, user.localAuth.hash);
    if (!ok) {
      registerAuthFailure(req, "password");
      registerAuthFailure(req, "password", auth.user.id);
      writeSecurityEvent("auth_password_change_failed", req, { reason: "wrong_current", userId: auth.user.id });
      sendJson(res, 401, { error: "Contrasena actual incorrecta" });
      return;
    }
  }

  const updated = setOrUpdateLocalPassword(user, newPassword);
  invalidatePasswordResetTokensForUser(auth.user.id);
  registerAuthSuccess(req, "password");
  registerAuthSuccess(req, "password", auth.user.id);
  writeSecurityEvent("auth_password_change_success", req, { userId: auth.user.id });
  sendJson(res, 200, {
    ok: true,
    message: hasLocal ? "Contrasena actualizada" : "Contrasena configurada",
    user: publicUser(updated)
  });
}

async function handleAuthSessions(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;
  const items = listActiveSessionsForUser(auth.user.id, auth.sessionId);
  sendJson(res, 200, { items });
}

async function handleAuthSessionsRevoke(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  const body = await readJsonBody(req, res);
  if (body === null) return;

  const targetSessionId = String(body?.sessionId || "").trim();
  if (!targetSessionId) {
    writeSecurityEvent("auth_session_revoke_failed", req, { reason: "missing_session_id", userId: auth.user.id });
    sendJson(res, 400, { error: "Falta sessionId" });
    return;
  }

  const target = SESSIONS.get(targetSessionId);
  if (!target || target.userId !== auth.user.id) {
    writeSecurityEvent("auth_session_revoke_failed", req, { reason: "session_not_found", userId: auth.user.id });
    sendJson(res, 404, { error: "Sesion no encontrada" });
    return;
  }

  const isCurrent = targetSessionId === auth.sessionId;
  SESSIONS.delete(targetSessionId);
  persistSessionsSoon();

  if (isCurrent) {
    clearSessionCookie(res);
  }
  writeSecurityEvent("auth_session_revoke_success", req, {
    userId: auth.user.id,
    revokedSessionId: targetSessionId,
    current: isCurrent
  });

  sendJson(res, 200, {
    ok: true,
    revokedSessionId: targetSessionId,
    signedOut: isCurrent
  });
}

async function handleAuthSessionsRevokeOthers(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  let removed = 0;
  for (const [sid, session] of SESSIONS.entries()) {
    if (!session || session.userId !== auth.user.id) continue;
    if (sid === auth.sessionId) continue;
    SESSIONS.delete(sid);
    removed += 1;
  }
  if (removed > 0) persistSessionsSoon();
  writeSecurityEvent("auth_session_revoke_others", req, { userId: auth.user.id, removed });
  sendJson(res, 200, { ok: true, removed });
}

async function handleProfileMe(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  const profile = ensureProfile(auth.user.id);
  sendJson(res, 200, {
    user: publicUser(auth.user),
    profile: profilePayload(profile)
  });
}

async function handleProfileToggleList(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  const body = await readJsonBody(req, res);
  if (body === null) return;

  const list = String(body?.list || "").trim();
  if (list !== "favorites" && list !== "pending") {
    sendJson(res, 400, { error: "Lista invalida" });
    return;
  }

  const anime = sanitizeAnimePayload(body?.anime || {});
  if (!anime) {
    sendJson(res, 400, { error: "Anime invalido" });
    return;
  }

  const profile = ensureProfile(auth.user.id);
  const result = listToggle(profile, list, anime, list === "favorites" ? MAX_FAVORITES : MAX_PENDING);
  saveDatabase();
  sendJson(res, 200, {
    ok: true,
    list,
    added: result.added,
    profile: profilePayload(profile)
  });
}

async function handleProfileHistoryUpsert(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  const body = await readJsonBody(req, res);
  if (body === null) return;

  const entry = sanitizeHistoryPayload(body);
  if (!entry) {
    sendJson(res, 400, { error: "Historial invalido" });
    return;
  }

  const profile = ensureProfile(auth.user.id);
  upsertHistory(profile, entry);
  saveDatabase();
  sendJson(res, 200, {
    ok: true,
    profile: profilePayload(profile)
  });
}

async function handleProfileHistoryRemove(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  const body = await readJsonBody(req, res);
  if (body === null) return;

  const profile = ensureProfile(auth.user.id);
  const changed = removeHistoryByAnimeId(profile, body?.animeId);
  if (changed) saveDatabase();
  sendJson(res, 200, {
    ok: true,
    profile: profilePayload(profile)
  });
}

async function handleProfileHistoryClear(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  const profile = ensureProfile(auth.user.id);
  clearHistory(profile);
  saveDatabase();
  sendJson(res, 200, {
    ok: true,
    profile: profilePayload(profile)
  });
}

async function handleProfileRecommendations(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  const profile = ensureProfile(auth.user.id);
  try {
    const list = await buildRecommendations(profile, 24);
    sendJson(res, 200, { items: list });
  } catch (error) {
    sendJson(res, 200, { items: [], warning: String(error.message || error) });
  }
}

async function handleAniList(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;

  const query = String(body?.query || "").trim();
  const variables = body?.variables && typeof body.variables === "object" ? body.variables : {};
  if (!query) {
    sendJson(res, 400, { error: "Falta query GraphQL" });
    return;
  }

  const cacheKey = `anilist:${JSON.stringify({ query, variables })}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader("X-Proxy-Cache", "HIT");
    sendJson(res, 200, cached);
    return;
  }

  const upstream = await fetchJson(ANILIST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!upstream.ok) {
    sendJson(res, upstream.status || 502, { error: "Error AniList", details: upstream.json });
    return;
  }

  cacheSet(cacheKey, upstream.json, 60_000);
  res.setHeader("X-Proxy-Cache", "MISS");
  sendJson(res, 200, upstream.json);
}

async function handleJikan(req, res, parsedUrl) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const restPath = parsedUrl.pathname.replace(/^\/api\/jikan/, "");
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(restPath) || !restPath) {
    sendJson(res, 400, { error: "Ruta Jikan invalida" });
    return;
  }

  const target = new URL(`${JIKAN_URL}${restPath}`);
  for (const [k, v] of parsedUrl.searchParams.entries()) {
    target.searchParams.set(k, v);
  }

  const cacheKey = `jikan:${target.toString()}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader("X-Proxy-Cache", "HIT");
    sendJson(res, 200, { data: cached });
    return;
  }

  const upstream = await fetchJson(target.toString(), {
    headers: { Accept: "application/json" }
  });
  if (!upstream.ok) {
    sendJson(res, upstream.status || 502, { error: "Error Jikan", details: upstream.json });
    return;
  }

  const data = upstream.json?.data || [];
  cacheSet(cacheKey, data, 5 * 60_000);
  res.setHeader("X-Proxy-Cache", "MISS");
  sendJson(res, 200, { data });
}

async function handleTranslate(req, res, parsedUrl) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const q = String(parsedUrl.searchParams.get("q") || "").trim();
  const source = String(parsedUrl.searchParams.get("source") || "en").trim();
  const target = String(parsedUrl.searchParams.get("target") || "es").trim();
  if (!q) {
    sendJson(res, 400, { error: "Falta texto para traducir" });
    return;
  }
  if (q.length > 1200) {
    sendJson(res, 400, { error: "Texto demasiado largo para traduccion" });
    return;
  }

  const cacheKey = `translate:${source}:${target}:${q}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader("X-Proxy-Cache", "HIT");
    sendJson(res, 200, cached);
    return;
  }

  const url = new URL(TRANSLATE_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("langpair", `${source}|${target}`);

  const upstream = await fetchJson(url.toString(), {
    headers: { Accept: "application/json" }
  });
  if (!upstream.ok) {
    sendJson(res, upstream.status || 502, { error: "Error traductor", details: upstream.json });
    return;
  }

  cacheSet(cacheKey, upstream.json, 12 * 60 * 60_000);
  res.setHeader("X-Proxy-Cache", "MISS");
  sendJson(res, 200, upstream.json);
}

async function handleSynopsis(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;

  const id = Number(body?.id || 0);
  const idMal = Number(body?.idMal || 0);
  const description = cleanText(body?.description || "");
  const title = chooseBestTitle(body || {});
  const cacheKey = `synopsis:v2:${id || "x"}:${idMal || "x"}:${title}:${description.length}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader("X-Proxy-Cache", "HIT");
    sendJson(res, 200, cached);
    return;
  }

  let source = "";
  let sourceProvider = "";

  if (description) {
    source = description;
    sourceProvider = "anilist";
  }

  if (!source) {
    const fromJikan = await fetchJikanSynopsis(idMal);
    if (fromJikan) {
      source = fromJikan;
      sourceProvider = "jikan";
    }
  }

  if (!source) {
    const fromKitsu = await fetchKitsuSynopsisByTitle(title);
    if (fromKitsu) {
      source = fromKitsu;
      sourceProvider = "kitsu";
    }
  }

  if (!source) {
    const payload = {
      synopsis: "Sin sinopsis disponible.",
      source: "none",
      translated: false
    };
    cacheSet(cacheKey, payload, 30 * 60_000);
    res.setHeader("X-Proxy-Cache", "MISS");
    sendJson(res, 200, payload);
    return;
  }

  let synopsis = source;
  let translated = false;
  try {
    const translatedText = await translateTextToSpanish(source);
    if (translatedText) {
      synopsis = translatedText;
      translated = !looksSpanish(source) && synopsis !== source;
    }
  } catch {
    synopsis = source;
    translated = false;
  }

  const payload = {
    synopsis: cleanText(synopsis) || "Sin sinopsis disponible.",
    source: sourceProvider || "unknown",
    translated
  };
  cacheSet(cacheKey, payload, 7 * 24 * 60 * 60_000);
  res.setHeader("X-Proxy-Cache", "MISS");
  sendJson(res, 200, payload);
}

async function handleImageQuality(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;

  const ids = toPositiveIntArray(body?.ids, 18);
  if (!ids.length) {
    sendJson(res, 200, { items: [] });
    return;
  }

  const items = await mapLimit(ids, 2, async (idMal) => getBestImagesByMalId(idMal));
  sendJson(res, 200, { items: items.filter(Boolean) });
}

function isAllowedAvatarHost(hostname) {
  const host = String(hostname || "").toLowerCase().trim();
  if (!host) return false;
  return (
    host.endsWith("googleusercontent.com") ||
    host.endsWith("ggpht.com") ||
    host.endsWith("gstatic.com")
  );
}

async function handleAvatarProxy(req, res, parsedUrl) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  const raw = cleanUrl(parsedUrl.searchParams.get("u") || parsedUrl.searchParams.get("url") || "");
  if (!raw) {
    sendJson(res, 400, { error: "Avatar invalido" });
    return;
  }

  let target;
  try {
    target = new URL(raw);
  } catch {
    sendJson(res, 400, { error: "Avatar invalido" });
    return;
  }

  if (target.protocol !== "https:") {
    sendJson(res, 400, { error: "Avatar invalido" });
    return;
  }

  if (!isAllowedAvatarHost(target.hostname)) {
    sendJson(res, 403, { error: "Host de avatar no permitido" });
    return;
  }

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      headers: {
        Accept: "image/*",
        "User-Agent": "YumeVerse/1.0"
      }
    });

    if (!response.ok) {
      sendJson(res, 502, { error: "No se pudo obtener el avatar" });
      return;
    }

    const contentType = String(response.headers.get("content-type") || "image/jpeg").toLowerCase();
    if (!contentType.startsWith("image/")) {
      sendJson(res, 415, { error: "Contenido de avatar invalido" });
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=43200"
    });
    res.end(buffer);
  } catch {
    sendJson(res, 502, { error: "No se pudo obtener el avatar" });
  }
}

function safeFilePath(urlPath) {
  let requested = decodeURIComponent(urlPath || "/");
  if (requested === "/") requested = "/index.html";
  const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(ROOT, normalized);
  if (!full.startsWith(ROOT)) return null;
  if (full.startsWith(DATA_DIR)) return null;
  return full;
}

function serveStatic(res, parsedUrl) {
  const filePath = safeFilePath(parsedUrl.pathname);
  if (!filePath) {
    sendText(res, 403, "Acceso denegado");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      sendText(res, 404, "No encontrado");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    fs.createReadStream(filePath).pipe(res);
  });
}

let DB = loadDatabase();
loadSessionStore();
validateSessionSecret();
validateSessionCookieConfig();
cleanupPasswordResetTokens();
cleanupEmailVerifyTokens();

setInterval(() => {
  pruneExpiredSessions();
  pruneAuthRateMap();
  cleanupPasswordResetTokens();
  cleanupEmailVerifyTokens();
}, 5 * 60 * 1000).unref();

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    if (!enforceApiOriginPolicy(req, res, parsedUrl)) {
      return;
    }

    if (parsedUrl.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        cacheItems: CACHE.size,
        sessionItems: SESSIONS.size,
        googleAuthEnabled: Boolean(GOOGLE_CLIENT_ID),
        now: nowIso()
      });
      return;
    }

    if (parsedUrl.pathname === "/api/config") {
      await handleConfig(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/avatar") {
      await handleAvatarProxy(req, res, parsedUrl);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/session") {
      await handleAuthSession(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/sessions") {
      await handleAuthSessions(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/sessions/revoke") {
      await handleAuthSessionsRevoke(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/sessions/revoke-others") {
      await handleAuthSessionsRevokeOthers(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/google") {
      await handleAuthGoogle(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/register") {
      await handleAuthRegister(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/login") {
      await handleAuthLogin(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/logout") {
      await handleAuthLogout(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/email/resend") {
      await handleAuthEmailResend(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/email/verify") {
      await handleAuthEmailVerify(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/password/forgot") {
      await handleAuthPasswordForgot(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/password/reset") {
      await handleAuthPasswordReset(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/auth/password/change") {
      await handleAuthPasswordChange(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/profile/me") {
      await handleProfileMe(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/profile/list/toggle") {
      await handleProfileToggleList(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/profile/history/upsert") {
      await handleProfileHistoryUpsert(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/profile/history/remove") {
      await handleProfileHistoryRemove(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/profile/history/clear") {
      await handleProfileHistoryClear(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/profile/recommendations") {
      await handleProfileRecommendations(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/anilist") {
      await handleAniList(req, res);
      return;
    }

    if (parsedUrl.pathname.startsWith("/api/jikan/")) {
      await handleJikan(req, res, parsedUrl);
      return;
    }

    if (parsedUrl.pathname === "/api/translate") {
      await handleTranslate(req, res, parsedUrl);
      return;
    }

    if (parsedUrl.pathname === "/api/synopsis") {
      await handleSynopsis(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/image-quality") {
      await handleImageQuality(req, res);
      return;
    }

    serveStatic(res, parsedUrl);
  } catch (error) {
    sendJson(res, 500, { error: "Error interno", details: String(error.message || error) });
  }
});

let shuttingDown = false;
function shutdownServer(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  flushSessionStoreNow();
  try {
    server.close(() => {
      process.exit(code);
    });
  } catch {
    process.exit(code);
  }
  setTimeout(() => process.exit(code), 1500).unref();
}

process.on("SIGINT", () => shutdownServer(0));
process.on("SIGTERM", () => shutdownServer(0));
process.on("exit", () => {
  try {
    flushSessionStoreNow();
  } catch {}
});

server.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
  if (!GOOGLE_CLIENT_ID) {
    console.log("Aviso: define GOOGLE_CLIENT_ID para activar login con Google.");
  }
  if (process.env.NODE_ENV === "production" && !smtpReady) {
    console.log("Aviso: configura SMTP_* para habilitar verificacion de correo y recuperacion de contrasena en produccion.");
  }
});
