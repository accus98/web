const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");

const PORT = Number(process.env.PORT || 8787);
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, ".yv-data");
const DATA_FILE = path.join(DATA_DIR, "users.json");

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

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || "yv_change_this_secret").trim();
const SESSION_COOKIE = "yv_sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LEN = 6;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_FAVORITES = 200;
const MAX_PENDING = 200;
const MAX_HISTORY = 300;

const CACHE = new Map();
const MAX_CACHE_ITEMS = 700;
const SESSIONS = new Map();

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

function setSessionCookie(res, sessionId) {
  const token = `${sessionId}.${signSessionId(sessionId)}`;
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function createSession(userId) {
  const sessionId = crypto.randomBytes(24).toString("base64url");
  SESSIONS.set(sessionId, {
    userId,
    expiresAt: now() + SESSION_TTL_MS
  });
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
    return null;
  }
  session.expiresAt = now() + SESSION_TTL_MS;
  return { sessionId, ...session };
}

function pruneExpiredSessions() {
  const ts = now();
  for (const [sid, session] of SESSIONS.entries()) {
    if (!session || session.expiresAt <= ts) {
      SESSIONS.delete(sid);
    }
  }
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
    profiles: {}
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
      profiles: parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {}
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

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture || "",
    authProviders: normalizeProviders(user.authProviders || []),
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

function upsertLocalUser({ email, password, name }) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new Error("Correo invalido");
  }

  const safePassword = String(password || "");
  if (safePassword.length < PASSWORD_MIN_LEN) {
    throw new Error(`La contrasena debe tener al menos ${PASSWORD_MIN_LEN} caracteres`);
  }

  const displayName = normalizeDisplayName(name || normalizedEmail.split("@")[0]);
  const existing = findUserByEmail(normalizedEmail);
  const userId = existing?.id || `u_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const createdAt = existing?.createdAt || nowIso();
  const passwordPack = hashPassword(safePassword);
  const providers = normalizeProviders([...(existing?.authProviders || []), "local"]);

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
    }
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

  user.lastLoginAt = nowIso();
  user.authProviders = normalizeProviders([...(user.authProviders || []), "local"]);
  DB.users[user.id] = user;
  saveDatabase();
  return user;
}

function upsertGoogleUser(payload) {
  const googleSub = String(payload?.sub || "").trim();
  const email = normalizeEmail(payload?.email || "");
  const displayName = normalizeDisplayName(payload?.name || email.split("@")[0] || "Usuario");
  const picture = cleanUrl(payload?.picture || "");

  if (!googleSub || !email) {
    throw new Error("Payload Google invalido");
  }

  const existingByGoogle = DB.googleIndex[googleSub];
  const existingByEmail = DB.emailIndex[email];
  const userId = existingByGoogle || existingByEmail || `u_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const previous = DB.users[userId] || null;
  const createdAt = previous?.createdAt || nowIso();
  const providers = normalizeProviders([...(previous?.authProviders || []), "google", previous?.localAuth ? "local" : ""]);

  const user = {
    ...(previous || {}),
    id: userId,
    googleSub,
    email,
    name: displayName,
    picture,
    createdAt,
    lastLoginAt: nowIso(),
    authProviders: providers
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
  const cacheKey = `imageq:v1:${idMal}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const fullUrl = `${JIKAN_URL}/anime/${encodeURIComponent(idMal)}/full`;
  const upstream = await fetchJson(fullUrl, { headers: { Accept: "application/json" } });
  if (!upstream.ok || !upstream.json?.data) {
    const empty = { idMal, cover: "", banner: "", thumb: "", qualityScore: 0, source: "none" };
    cacheSet(cacheKey, empty, 12 * 60 * 60_000);
    return empty;
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
    passwordMinLen: PASSWORD_MIN_LEN
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

  if (!googleClient || !GOOGLE_CLIENT_ID) {
    sendJson(res, 503, { error: "Google Auth no configurado. Define GOOGLE_CLIENT_ID." });
    return;
  }

  const body = await readJsonBody(req, res);
  if (body === null) return;
  const credential = String(body?.credential || "").trim();
  if (!credential) {
    sendJson(res, 400, { error: "Falta credential" });
    return;
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload() || {};

    if (!payload.sub || !payload.email) {
      sendJson(res, 401, { error: "Token Google invalido" });
      return;
    }

    if (payload.email_verified === false) {
      sendJson(res, 401, { error: "Correo Google no verificado" });
      return;
    }

    const user = upsertGoogleUser(payload);
    const sessionId = createSession(user.id);
    setSessionCookie(res, sessionId);

    const profile = ensureProfile(user.id);
    sendJson(res, 200, {
      authenticated: true,
      user: publicUser(user),
      stats: profileStats(profile)
    });
  } catch (error) {
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

  if (!isValidEmail(email)) {
    sendJson(res, 400, { error: "Correo invalido" });
    return;
  }
  if (password.length < PASSWORD_MIN_LEN) {
    sendJson(res, 400, { error: `La contrasena debe tener al menos ${PASSWORD_MIN_LEN} caracteres` });
    return;
  }

  try {
    const user = upsertLocalUser({ email, password, name });
    const sessionId = createSession(user.id);
    setSessionCookie(res, sessionId);
    const profile = ensureProfile(user.id);
    sendJson(res, 200, {
      authenticated: true,
      user: publicUser(user),
      stats: profileStats(profile)
    });
  } catch (error) {
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

  if (!isValidEmail(email)) {
    sendJson(res, 400, { error: "Correo invalido" });
    return;
  }
  if (!password) {
    sendJson(res, 400, { error: "Falta contrasena" });
    return;
  }

  try {
    const user = loginLocalUser({ email, password });
    const sessionId = createSession(user.id);
    setSessionCookie(res, sessionId);
    const profile = ensureProfile(user.id);
    sendJson(res, 200, {
      authenticated: true,
      user: publicUser(user),
      stats: profileStats(profile)
    });
  } catch (error) {
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
  }
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
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

  const ids = toPositiveIntArray(body?.ids, 40);
  if (!ids.length) {
    sendJson(res, 200, { items: [] });
    return;
  }

  const items = await mapLimit(ids, 4, async (idMal) => getBestImagesByMalId(idMal));
  sendJson(res, 200, { items: items.filter(Boolean) });
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

setInterval(() => {
  pruneExpiredSessions();
}, 5 * 60 * 1000).unref();

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

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

    if (parsedUrl.pathname === "/api/auth/session") {
      await handleAuthSession(req, res);
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

server.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
  if (!GOOGLE_CLIENT_ID) {
    console.log("Aviso: define GOOGLE_CLIENT_ID para activar login con Google.");
  }
});
