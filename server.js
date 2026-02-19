const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const ROOT = process.cwd();
const ANILIST_URL = "https://graphql.anilist.co";
const JIKAN_URL = "https://api.jikan.moe/v4";
const KITSU_URL = "https://kitsu.io/api/edge";
const TRANSLATE_URL = "https://api.mymemory.translated.net/get";
const GOOGLE_TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";

const CACHE = new Map();
const MAX_CACHE_ITEMS = 500;

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

function now() {
  return Date.now();
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

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
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

function looksSpanish(text) {
  const sample = cleanText(text).toLowerCase();
  if (!sample) return false;
  if (/[áéíóúñ]/.test(sample)) return true;
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
    cover: cleanText(cover),
    banner: cleanText(banner),
    thumb: cleanText(thumb),
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

async function handleAniList(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo no permitido" });
    return;
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "JSON invalido" });
    return;
  }

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

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "JSON invalido" });
    return;
  }

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

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "JSON invalido" });
    return;
  }

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

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    if (parsedUrl.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, cacheItems: CACHE.size, now: new Date().toISOString() });
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
});
