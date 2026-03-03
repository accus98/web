const DIRECT_ANILIST_URL = "https://graphql.anilist.co";
const PROXY_ANILIST_URL = "/api/anilist";
const DIRECT_JIKAN_URL = "https://api.jikan.moe/v4";
const PROXY_JIKAN_URL = "/api/jikan";
const PROXY_SYNOPSIS_URL = "/api/synopsis";
const PROXY_IMAGE_QUALITY_URL = "/api/image-quality";
const PROXY_LIBRARY_EPISODES_URL = "/api/library/episodes";
const PROXY_LIBRARY_REQUEST_URL = "/api/library/request";

const STATUS_MAP = {
  FINISHED: "Finalizado",
  RELEASING: "En emision",
  NOT_YET_RELEASED: "Proximamente",
  CANCELLED: "Cancelado",
  HIATUS: "En pausa"
};

const SEASON_MAP = {
  WINTER: "Invierno",
  SPRING: "Primavera",
  SUMMER: "Verano",
  FALL: "Otono"
};

const SERVERS = ["Desu", "Magi", "Mega", "Streamwish", "VOE", "Filemoon", "Mixdrop", "Mp4upload"];

const detailQuery = `
query Detail($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    description(asHtml: false)
    idMal
    averageScore
    episodes
    duration
    season
    seasonYear
    status
    genres
    siteUrl
    coverImage { extraLarge large medium }
    bannerImage
    trailer { id site thumbnail }
    streamingEpisodes {
      title
      thumbnail
      url
      site
    }
  }
}
`;

const el = {
  animeHeader: document.getElementById("animeHeader"),
  animePoster: document.getElementById("animePoster"),
  animeTitle: document.getElementById("animeTitle"),
  animeMeta: document.getElementById("animeMeta"),
  animeGenres: document.getElementById("animeGenres"),
  animeDescription: document.getElementById("animeDescription"),
  serverTabs: document.getElementById("serverTabs"),
  playerArea: document.getElementById("playerArea"),
  playerTitle: document.getElementById("playerTitle"),
  playerNote: document.getElementById("playerNote"),
  languageSelect: document.getElementById("languageSelect"),
  episodeSearch: document.getElementById("episodeSearch"),
  episodeList: document.getElementById("episodeList"),
  commentForm: document.getElementById("commentForm"),
  commentName: document.getElementById("commentName"),
  commentText: document.getElementById("commentText"),
  commentList: document.getElementById("commentList"),
  favoriteToggle: document.getElementById("favoriteToggle"),
  pendingToggle: document.getElementById("pendingToggle")
};

const state = {
  anime: null,
  synopsisEs: "",
  episodes: [],
  libraryEpisodes: [],
  requestedEpisode: 1,
  currentEpisodeIndex: 0,
  currentServer: "",
  comments: [],
  session: { authenticated: false },
  favoriteActive: false,
  pendingActive: false
};

const bannerMetaCache = new Map();
let headerBackdropToken = 0;
const CONTINUE_KEY = "yv_continue_v1";
const MAX_CONTINUE_ITEMS = 24;
let activeHls = null;
let libraryPollTimer = null;
let libraryRefreshPromise = null;

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pickTitle(title) {
  return title?.english || title?.romaji || title?.native || "Anime";
}

function bestCover(coverImage) {
  return coverImage?.extraLarge || coverImage?.large || coverImage?.medium || "";
}

function cssUrl(url) {
  return String(url || "").replace(/'/g, "%27");
}

function loadImageMeta(url) {
  const key = String(url || "").trim();
  if (!key) return Promise.resolve({ width: 0, height: 0 });
  if (bannerMetaCache.has(key)) return bannerMetaCache.get(key);

  const promise = new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (meta) => {
      if (settled) return;
      settled = true;
      resolve(meta);
    };

    const timeout = setTimeout(() => finish({ width: 0, height: 0 }), 4200);
    img.onload = () => {
      clearTimeout(timeout);
      finish({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    };
    img.onerror = () => {
      clearTimeout(timeout);
      finish({ width: 0, height: 0 });
    };
    img.decoding = "async";
    img.src = key;
  });

  bannerMetaCache.set(key, promise);
  return promise;
}

function setAnimeHeaderBackdrop(url, lowRes = false) {
  if (url) {
    el.animeHeader.style.setProperty("--anime-banner", `url('${cssUrl(url)}')`);
    el.animeHeader.classList.remove("no-banner");
  } else {
    el.animeHeader.style.removeProperty("--anime-banner");
    el.animeHeader.classList.add("no-banner");
  }
  el.animeHeader.classList.toggle("low-res", Boolean(lowRes));
}

async function refineAnimeHeaderBackdrop(anime) {
  const token = ++headerBackdropToken;
  const banner = String(anime?.bannerImage || "").trim();
  const poster = String(bestCover(anime?.coverImage) || "").trim();
  if (!banner && !poster) {
    setAnimeHeaderBackdrop("", false);
    return;
  }

  if (banner) {
    const bannerMeta = await loadImageMeta(banner);
    if (token !== headerBackdropToken) return;

    if (bannerMeta.width >= 1200 && bannerMeta.height >= 420) {
      setAnimeHeaderBackdrop(banner, false);
      return;
    }

    if (bannerMeta.width >= 860 && bannerMeta.height >= 300) {
      setAnimeHeaderBackdrop(banner, true);
      return;
    }
  }

  if (poster) {
    const posterMeta = await loadImageMeta(poster);
    if (token !== headerBackdropToken) return;

    if (posterMeta.width >= 500 && posterMeta.height >= 700) {
      setAnimeHeaderBackdrop(poster, true);
      return;
    }
  }

  if (token !== headerBackdropToken) return;
  if (poster) {
    setAnimeHeaderBackdrop(poster, true);
    return;
  }

  setAnimeHeaderBackdrop("", false);
}

function cleanDescription(text) {
  return String(text || "Sin sinopsis disponible.")
    .replace(/\(\s*source\s*:[^)]+\)\s*$/i, "")
    .replace(/\(\s*fuente\s*:[^)]+\)\s*$/i, "")
    .replace(/\bsource\s*:[^.]+\.?\s*$/i, "")
    .replace(/\bfuente\s*:[^.]+\.?\s*$/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAuthenticated() {
  return Boolean(state.session?.authenticated);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error || `HTTP ${response.status}`));
  }
  return data;
}

function buildAnimePayload() {
  if (!state.anime) return null;
  return {
    animeId: Number(state.anime.id || 0),
    idMal: Number(state.anime.idMal || 0),
    title: pickTitle(state.anime.title),
    cover: bestCover(state.anime.coverImage),
    banner: String(state.anime.bannerImage || "").trim(),
    score: Number(state.anime.averageScore || 0),
    status: String(state.anime.status || "").trim(),
    episodes: Number(state.anime.episodes || 0),
    seasonYear: Number(state.anime.seasonYear || 0),
    genres: Array.isArray(state.anime.genres) ? state.anime.genres.slice(0, 8) : []
  };
}

async function loadProfileFlags() {
  state.favoriteActive = false;
  state.pendingActive = false;
  if (!isAuthenticated() || !state.anime) return;

  try {
    const json = await requestJson("/api/profile/me");
    const profile = json?.profile || {};
    const animeId = Number(state.anime.id || 0);
    state.favoriteActive = (profile.favorites || []).some((item) => Number(item?.animeId || 0) === animeId);
    state.pendingActive = (profile.pending || []).some((item) => Number(item?.animeId || 0) === animeId);
  } catch {}
}

function renderListButtons() {
  if (!el.favoriteToggle || !el.pendingToggle) return;

  if (!isAuthenticated()) {
    el.favoriteToggle.textContent = "Agregar a favoritos";
    el.pendingToggle.textContent = "Marcar pendiente";
    el.favoriteToggle.classList.remove("btn-primary");
    el.pendingToggle.classList.remove("btn-primary");
    el.favoriteToggle.classList.add("btn-ghost");
    el.pendingToggle.classList.add("btn-ghost");
    return;
  }

  el.favoriteToggle.textContent = state.favoriteActive ? "Quitar de favoritos" : "Agregar a favoritos";
  el.pendingToggle.textContent = state.pendingActive ? "Quitar de pendientes" : "Marcar pendiente";

  el.favoriteToggle.classList.toggle("btn-primary", state.favoriteActive);
  el.pendingToggle.classList.toggle("btn-primary", state.pendingActive);
  el.favoriteToggle.classList.toggle("btn-ghost", !state.favoriteActive);
  el.pendingToggle.classList.toggle("btn-ghost", !state.pendingActive);
}

async function toggleList(listName) {
  const anime = buildAnimePayload();
  if (!anime) return;

  await requestJson("/api/profile/list/toggle", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      list: listName,
      anime
    })
  });
  await loadProfileFlags();
  renderListButtons();
}

function looksSpanish(text) {
  const sample = String(text || "").toLowerCase();
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

function chunkText(text, maxLen = 430) {
  const parts = String(text || "").split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";
  parts.forEach((part) => {
    if (!part) return;
    if ((current + " " + part).trim().length <= maxLen) {
      current = `${current} ${part}`.trim();
      return;
    }
    if (current) chunks.push(current);
    if (part.length <= maxLen) {
      current = part;
      return;
    }
    for (let i = 0; i < part.length; i += maxLen) {
      chunks.push(part.slice(i, i + maxLen));
    }
    current = "";
  });
  if (current) chunks.push(current);
  return chunks.length ? chunks : [String(text || "")];
}

async function translateChunkToSpanish(chunk) {
  const url =
    window.location.protocol === "file:"
      ? `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|es`
      : `/api/translate?q=${encodeURIComponent(chunk)}&source=en&target=es`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Translate ${r.status}`);
  const json = await r.json();
  const translated = String(json?.responseData?.translatedText || "").trim();
  if (!translated || /QUERY LENGTH LIMIT EXCEEDED/i.test(translated)) {
    throw new Error("Translate limit");
  }
  return translated;
}

async function translateToSpanish(text) {
  const source = cleanDescription(text);
  if (!source || source === "Sin sinopsis disponible.") return source;
  if (looksSpanish(source)) return source;

  const chunks = chunkText(source);
  const out = [];
  for (const chunk of chunks) {
    const translated = await translateChunkToSpanish(chunk);
    out.push(translated);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

async function fetchJikanSynopsis(idMal) {
  if (!idMal) return "";
  const endpoint =
    window.location.protocol === "file:"
      ? `${DIRECT_JIKAN_URL}/anime/${idMal}/full`
      : `${PROXY_JIKAN_URL}/anime/${idMal}/full`;
  const r = await fetch(endpoint, {
    headers: { Accept: "application/json" }
  });
  if (!r.ok) return "";
  const json = await r.json();
  return cleanDescription(json?.data?.synopsis || "");
}

function synopsisCacheKey(anime) {
  const base = cleanDescription(anime?.description || "");
  const hashPart = `${anime?.id || "x"}_${anime?.idMal || "x"}_${base.length}`;
  return `yv_synopsis_es_${hashPart}`;
}

async function requestSynopsisFromBackend(anime) {
  const response = await fetch(PROXY_SYNOPSIS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      id: anime?.id || 0,
      idMal: anime?.idMal || 0,
      description: anime?.description || "",
      titleEnglish: anime?.title?.english || "",
      titleRomaji: anime?.title?.romaji || "",
      titleNative: anime?.title?.native || ""
    })
  });
  if (!response.ok) throw new Error(`Synopsis ${response.status}`);
  const json = await response.json();
  return cleanDescription(json?.synopsis || "");
}

async function requestBestImageByMal(idMal) {
  if (!idMal || window.location.protocol === "file:") return null;
  const response = await fetch(PROXY_IMAGE_QUALITY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ ids: [idMal] })
  });
  if (!response.ok) throw new Error(`ImageQuality ${response.status}`);
  const json = await response.json();
  return (json?.items || []).find((item) => Number(item?.idMal || 0) === Number(idMal)) || null;
}

async function enhanceAnimeImageQuality(anime) {
  const idMal = Number(anime?.idMal || 0);
  if (!idMal) return anime;
  try {
    const best = await requestBestImageByMal(idMal);
    if (!best) return anime;
    return {
      ...anime,
      coverImage: {
        extraLarge: best.cover || anime?.coverImage?.extraLarge || anime?.coverImage?.large || anime?.coverImage?.medium || "",
        large: best.cover || anime?.coverImage?.large || anime?.coverImage?.extraLarge || anime?.coverImage?.medium || "",
        medium: anime?.coverImage?.medium || best.cover || anime?.coverImage?.large || anime?.coverImage?.extraLarge || ""
      },
      bannerImage: best.banner || anime?.bannerImage || ""
    };
  } catch {
    return anime;
  }
}

async function buildSpanishSynopsis(anime) {
  const cacheKey = synopsisCacheKey(anime);
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;
  } catch {}

  if (window.location.protocol !== "file:") {
    try {
      const fromBackend = await requestSynopsisFromBackend(anime);
      if (fromBackend) {
        try {
          localStorage.setItem(cacheKey, fromBackend);
        } catch {}
        return fromBackend;
      }
    } catch {}
  }

  let base = cleanDescription(anime.description);
  if (!base || base === "Sin sinopsis disponible.") {
    base = await fetchJikanSynopsis(anime.idMal);
  }
  if (!base || base === "Sin sinopsis disponible.") {
    return "Sin sinopsis disponible.";
  }

  let translated = base;
  try {
    translated = await translateToSpanish(base);
  } catch {
    translated = base;
  }

  try {
    localStorage.setItem(cacheKey, translated);
  } catch {}
  return translated;
}

function parseEpisodeNumber(title, fallback) {
  const m = String(title || "").match(/episode\\s*(\\d+)/i);
  return m ? Number(m[1]) : fallback;
}

async function requestLibraryEpisodes(animeId) {
  if (!Number.isInteger(Number(animeId)) || Number(animeId) <= 0) return [];
  try {
    const json = await requestJson(`${PROXY_LIBRARY_EPISODES_URL}?animeId=${encodeURIComponent(animeId)}`);
    return Array.isArray(json?.episodes) ? json.episodes : [];
  } catch {
    return [];
  }
}

function normalizeEpisodeState(value) {
  return String(value || "").trim().toUpperCase();
}

function episodeStateLabel(value) {
  const stateValue = normalizeEpisodeState(value);
  if (!stateValue) return "Sin solicitar";
  const labels = {
    COMPLETED: "Disponible",
    IDLE: "Sin solicitar",
    TRANSCODING: "Procesando HLS",
    UPLOADING: "Subiendo",
    DEBRID_READY: "Preparando host",
    DEBRID_CONVERTING: "Descargando en debrid",
    DEBRID_PENDING: "Esperando debrid",
    MAGNET_FOUND: "Torrent encontrado",
    SEARCHING: "Buscando torrent",
    DOWNLOADING_LOCAL: "Descarga local",
    DOWNLOADED_LOCAL: "Local",
    FAILED: "Fallo"
  };
  return labels[stateValue] || stateValue;
}

function buildEpisodeSources(anime, botEpisode, streamEpisode) {
  const sources = [];
  if (botEpisode?.hls_url) {
    sources.push({
      name: "YumeVerse",
      type: "hls",
      url: botEpisode.hls_url
    });
  }
  if (botEpisode?.embed_url) {
    sources.push({
      name: "SeekStreaming",
      type: "embed",
      url: botEpisode.embed_url
    });
  }
  if (streamEpisode?.url) {
    sources.push({
      name: streamEpisode.site || "Externo",
      type: "external",
      url: streamEpisode.url,
      site: streamEpisode.site || ""
    });
  }
  const trailerId = String(anime?.trailer?.id || "").trim();
  if (String(anime?.trailer?.site || "").toLowerCase() === "youtube" && trailerId) {
    sources.push({
      name: "Trailer",
      type: "trailer",
      trailerId
    });
  }
  return sources;
}

function buildEpisodes(anime, libraryEpisodes = []) {
  const streams = (anime.streamingEpisodes || [])
    .map((ep, idx) => ({
      number: parseEpisodeNumber(ep.title, idx + 1),
      title: ep.title || `Episodio ${idx + 1}`,
      thumbnail: ep.thumbnail || bestCover(anime.coverImage),
      url: ep.url || "",
      site: ep.site || ""
    }))
    .sort((a, b) => a.number - b.number);

  const streamMap = new Map(streams.map((ep) => [Number(ep.number || 0), ep]));
  const botMap = new Map(
    (Array.isArray(libraryEpisodes) ? libraryEpisodes : [])
      .map((ep) => ({
        ...ep,
        episode_number: Number(ep?.episode_number || 0)
      }))
      .filter((ep) => ep.episode_number > 0)
      .map((ep) => [ep.episode_number, ep])
  );

  const streamMax = streams.reduce((acc, item) => Math.max(acc, Number(item.number || 0)), 0);
  const botMax = Array.from(botMap.keys()).reduce((acc, item) => Math.max(acc, Number(item || 0)), 0);
  const fallbackTotal = Number(anime.episodes || 0) > 0 ? Number(anime.episodes || 0) : 12;
  const total = Math.max(fallbackTotal, streamMax, botMax);

  return Array.from({ length: total }).map((_, index) => {
    const number = index + 1;
    const streamEpisode = streamMap.get(number) || null;
    const botEpisode = botMap.get(number) || null;
    return {
      number,
      title: streamEpisode?.title || botEpisode?.title || `Episodio ${number}`,
      thumbnail: streamEpisode?.thumbnail || bestCover(anime.coverImage),
      url: streamEpisode?.url || "",
      site: streamEpisode?.site || "",
      state: normalizeEpisodeState(botEpisode?.state || ""),
      ready: Boolean(botEpisode?.ready),
      fileCode: String(botEpisode?.file_code || ""),
      hlsUrl: String(botEpisode?.hls_url || ""),
      embedUrl: String(botEpisode?.embed_url || ""),
      playbackKind: String(botEpisode?.playback_kind || ""),
      sources: buildEpisodeSources(anime, botEpisode, streamEpisode)
    };
  });
}

function currentEpisode() {
  return state.episodes[state.currentEpisodeIndex] || null;
}

function currentEpisodeSources() {
  return Array.isArray(currentEpisode()?.sources) ? currentEpisode().sources : [];
}

function ensureCurrentServer() {
  const sources = currentEpisodeSources();
  if (!sources.length) {
    state.currentServer = "";
    return null;
  }
  const selected = sources.find((source) => source.name === state.currentServer);
  if (selected) return selected;
  const preferred = sources.find((source) => source.type !== "trailer") || null;
  if (preferred) {
    state.currentServer = preferred.name;
    return preferred;
  }
  state.currentServer = "";
  return null;
}

function destroyActiveHls() {
  if (activeHls && typeof activeHls.destroy === "function") {
    activeHls.destroy();
  }
  activeHls = null;
}

function rebuildEpisodesPreservingSelection() {
  const selectedNumber = currentEpisode()?.number || state.requestedEpisode || 1;
  state.episodes = buildEpisodes(state.anime, state.libraryEpisodes);
  const nextIndex = state.episodes.findIndex((episode) => Number(episode.number) === Number(selectedNumber));
  state.currentEpisodeIndex = nextIndex >= 0 ? nextIndex : Math.max(0, Math.min(state.requestedEpisode - 1, state.episodes.length - 1));
}

function stopLibraryPolling() {
  if (libraryPollTimer) {
    window.clearInterval(libraryPollTimer);
    libraryPollTimer = null;
  }
}

async function refreshLibraryEpisodes(options = {}) {
  if (!state.anime) return [];
  if (libraryRefreshPromise) return libraryRefreshPromise;

  const silent = options.silent !== false;
  libraryRefreshPromise = (async () => {
    const episodes = await requestLibraryEpisodes(Number(state.anime.id || 0));
    state.libraryEpisodes = episodes;
    rebuildEpisodesPreservingSelection();
    renderServerTabs();
    renderPlayer();
    renderEpisodes();
    return episodes;
  })();

  try {
    return await libraryRefreshPromise;
  } catch (error) {
    if (!silent && el.playerNote) {
      el.playerNote.textContent = `No se pudo refrescar el episodio. ${error.message || ""}`.trim();
    }
    throw error;
  } finally {
    libraryRefreshPromise = null;
  }
}

function startLibraryPolling() {
  stopLibraryPolling();
  libraryPollTimer = window.setInterval(() => {
    if (!state.anime || document.hidden) return;
    refreshLibraryEpisodes({ silent: true }).catch(() => {});
  }, 8000);
}

function commentKey() {
  const userId = isAuthenticated() ? String(state.session?.user?.id || "user") : "guest";
  return state.anime ? `yv_comments_${state.anime.id}_${userId}` : `yv_comments_unknown_${userId}`;
}

function loadComments() {
  try {
    state.comments = JSON.parse(localStorage.getItem(commentKey()) || "[]");
  } catch {
    state.comments = [];
  }
}

function saveComments() {
  try {
    localStorage.setItem(commentKey(), JSON.stringify(state.comments));
  } catch {}
}

function updateEpisodeQueryParam(epNumber) {
  if (!state.anime) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("id", String(state.anime.id));
    url.searchParams.set("ep", String(Math.max(1, Number(epNumber || 1))));
    window.history.replaceState(null, "", url.toString());
  } catch {}
}

function persistContinueWatching() {
  const anime = state.anime;
  const currentEpisode = state.episodes[state.currentEpisodeIndex];
  if (!anime || !currentEpisode) return;

  const entry = {
    animeId: Number(anime.id || 0),
    idMal: Number(anime.idMal || 0),
    title: pickTitle(anime.title),
    cover: bestCover(anime.coverImage),
    banner: String(anime.bannerImage || "").trim(),
    episodeNumber: Math.max(1, Number(currentEpisode.number || state.currentEpisodeIndex + 1 || 1)),
    episodeTitle: String(currentEpisode.title || "").trim(),
    totalEpisodes: Number(anime.episodes || episodeCount() || 0),
    updatedAt: Date.now(),
    status: String(anime.status || ""),
    score: Number(anime.averageScore || 0),
    genres: Array.isArray(anime.genres) ? anime.genres.slice(0, 6) : []
  };

  if (!entry.animeId || !entry.title) return;

  if (isAuthenticated()) {
    requestJson("/api/profile/history/upsert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        anime: {
          animeId: entry.animeId,
          idMal: entry.idMal,
          title: entry.title,
          cover: entry.cover,
          banner: entry.banner,
          score: entry.score,
          status: entry.status,
          episodes: Number(anime.episodes || 0),
          seasonYear: Number(anime.seasonYear || 0),
          genres: entry.genres
        },
        episodeNumber: entry.episodeNumber,
        episodeTitle: entry.episodeTitle,
        totalEpisodes: entry.totalEpisodes
      })
    }).catch(() => {});
    return;
  }

  try {
    const list = JSON.parse(localStorage.getItem(CONTINUE_KEY) || "[]");
    const safe = Array.isArray(list) ? list : [];
    const next = [entry, ...safe.filter((item) => Number(item?.animeId || 0) !== entry.animeId)].slice(0, MAX_CONTINUE_ITEMS);
    localStorage.setItem(CONTINUE_KEY, JSON.stringify(next));
  } catch {}
}

function requestAniList(query, variables = {}) {
  const requestAniListFrom = (url) => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ query, variables })
    })
      .then((r) => {
        if (!r.ok) throw new Error(`AniList ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (json.errors) throw new Error(json.errors[0]?.message || "GraphQL error");
        return json.data;
      });
  };

  if (window.location.protocol === "file:") {
    return requestAniListFrom(DIRECT_ANILIST_URL);
  }
  return requestAniListFrom(PROXY_ANILIST_URL).catch(() => requestAniListFrom(DIRECT_ANILIST_URL));
}

function renderHeader() {
  const anime = state.anime;
  const banner = anime.bannerImage || bestCover(anime.coverImage);
  const poster = bestCover(anime.coverImage);
  el.animePoster.src = poster;
  el.animePoster.alt = pickTitle(anime.title);
  el.animeTitle.textContent = pickTitle(anime.title);
  el.animeMeta.innerHTML = `
    <span>${anime.averageScore ? `Score ${anime.averageScore}` : "Sin score"}</span>
    <span>${anime.episodes ? `${anime.episodes} episodios` : "Episodios por confirmar"}</span>
    <span>${anime.duration ? `${anime.duration} min/ep` : "-"}</span>
    <span>${SEASON_MAP[anime.season] || anime.season || "-"} ${anime.seasonYear || ""}</span>
    <span>${STATUS_MAP[anime.status] || anime.status || "-"}</span>
  `;
  el.animeGenres.innerHTML = (anime.genres || []).map((g) => `<span class="genre-pill">${esc(g)}</span>`).join("");
  el.animeDescription.textContent = state.synopsisEs || cleanDescription(anime.description);
  setAnimeHeaderBackdrop(banner, false);
  refineAnimeHeaderBackdrop(anime);
}

function renderServerTabs() {
  const sources = currentEpisodeSources();
  if (!sources.length) {
    state.currentServer = "";
    el.serverTabs.innerHTML = `<span class="server-btn active">Sin fuente</span>`;
    return;
  }

  ensureCurrentServer();
  el.serverTabs.innerHTML = sources.map((source) => {
    const name = source.name || "Fuente";
    const active = name === state.currentServer ? "active" : "";
    return `<button class="server-btn ${active}" type="button" data-server="${esc(name)}">${esc(name)}</button>`;
  }).join("");
}

function renderRequestFallback(anime, episode) {
  const poster = bestCover(anime.coverImage);
  const stateLabel = episodeStateLabel(episode?.state);
  const loggedIn = Boolean(state.session?.authenticated);
  const buttonLabel = loggedIn ? `Solicitar episodio ${episode?.number || 1}` : "Inicia sesion para solicitar";
  el.playerArea.innerHTML = `
    <div class="player-fallback" style="background-image:url('${poster.replace(/'/g, "%27")}')">
      <div>
        <h4>${esc(episode?.title || pickTitle(anime.title))}</h4>
        <p>Estado: ${esc(stateLabel)}</p>
        <p>Cuando el pipeline termine, este episodio se reproducira desde SeekStreaming.</p>
        <p><button class="btn btn-primary" type="button" data-request-episode="${Number(episode?.number || 1)}">${esc(buttonLabel)}</button></p>
      </div>
    </div>
  `;
  el.playerNote.textContent = `Episodio ${episode?.number || 1} - ${stateLabel}`;
}

function renderHlsSource(source, anime, episode) {
  const poster = bestCover(anime.coverImage);
  el.playerArea.innerHTML = `<video id="animeVideo" controls playsinline preload="metadata" poster="${esc(poster)}"></video>`;
  const video = document.getElementById("animeVideo");
  if (!video) return false;

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = source.url;
    return true;
  }

  if (window.Hls && typeof window.Hls.isSupported === "function" && window.Hls.isSupported()) {
    activeHls = new window.Hls({
      enableWorker: true,
      lowLatencyMode: false
    });
    activeHls.loadSource(source.url);
    activeHls.attachMedia(video);
    activeHls.on(window.Hls.Events.ERROR, (_, data) => {
      if (data?.fatal && episode?.embedUrl) {
        destroyActiveHls();
        el.playerArea.innerHTML = `<iframe src="${esc(episode.embedUrl)}" title="SeekStreaming ${esc(pickTitle(anime.title))}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
      }
    });
    return true;
  }

  if (episode?.embedUrl) {
    el.playerArea.innerHTML = `<iframe src="${esc(episode.embedUrl)}" title="SeekStreaming ${esc(pickTitle(anime.title))}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    return true;
  }

  return false;
}

function renderPlayer() {
  destroyActiveHls();
  const anime = state.anime;
  const episode = currentEpisode();
  const title = pickTitle(anime.title);
  const epNumber = episode?.number || 1;
  el.playerTitle.textContent = `Episodio ${epNumber} - ${title}`;
  updateEpisodeQueryParam(epNumber);

  const selectedSource = ensureCurrentServer();
  if (!episode) {
    renderRequestFallback(anime, { number: epNumber, title });
    return;
  }

  if (!selectedSource) {
    renderRequestFallback(anime, episode);
    return;
  }

  if (selectedSource.type === "hls" && renderHlsSource(selectedSource, anime, episode)) {
    el.playerNote.textContent = `Servidor ${selectedSource.name} - HLS externo`;
    persistContinueWatching();
    return;
  }

  if (selectedSource.type === "embed" && selectedSource.url) {
    el.playerArea.innerHTML = `<iframe src="${esc(selectedSource.url)}" title="SeekStreaming ${esc(title)}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    el.playerNote.textContent = `Servidor ${selectedSource.name} - Reproductor externo`;
    persistContinueWatching();
    return;
  }

  if (selectedSource.type === "external" && selectedSource.url) {
    const thumb = String(episode.thumbnail || bestCover(anime.coverImage)).replace(/'/g, "%27");
    el.playerArea.innerHTML = `
      <div class="player-fallback" style="background-image:url('${thumb}')">
        <div>
          <h4>${esc(episode.title)}</h4>
          <p>Fuente: ${esc(selectedSource.site || selectedSource.name || state.currentServer)}</p>
          <p><a class="btn btn-primary" target="_blank" rel="noopener noreferrer" href="${esc(selectedSource.url)}">Abrir episodio</a></p>
        </div>
      </div>
    `;
    el.playerNote.textContent = `Servidor ${state.currentServer} - Episodio ${epNumber}`;
    persistContinueWatching();
    return;
  }

  if (selectedSource.type === "trailer" && selectedSource.trailerId) {
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(selectedSource.trailerId)}?rel=0&modestbranding=1`;
    el.playerArea.innerHTML = `<iframe src="${src}" title="Trailer ${esc(title)}" allowfullscreen loading="lazy"></iframe>`;
    el.playerNote.textContent = `Servidor ${state.currentServer} - Trailer oficial`;
    persistContinueWatching();
    return;
  }

  renderRequestFallback(anime, episode);
}

function episodeCount() {
  return state.episodes.length || 12;
}

function renderEpisodes() {
  const query = el.episodeSearch.value.trim().toLowerCase();
  const items = [];
  state.episodes.forEach((ep, idx) => {
    const label = `${ep.title}`.toLowerCase();
    if (query && !label.includes(query) && !String(ep.number).includes(query)) return;
    const active = idx === state.currentEpisodeIndex ? "active" : "";
    items.push(`
      <button type="button" class="episode-item ${active}" data-episode-index="${idx}">
        <img class="episode-thumb" src="${esc(ep.thumbnail || bestCover(state.anime.coverImage))}" alt="Episodio ${ep.number}" loading="lazy" />
        <span class="episode-info">
          <strong>Episodio ${ep.number}</strong>
          <span>${esc(ep.title || pickTitle(state.anime.title))}</span>
          <small class="episode-state">${esc(ep.ready ? "Disponible" : episodeStateLabel(ep.state))}</small>
        </span>
      </button>
    `);
  });
  el.episodeList.innerHTML = items.join("") || "<p>No hay episodios para ese filtro.</p>";
}

function renderComments() {
  if (!state.comments.length) {
    el.commentList.innerHTML = "<p>Sin comentarios todavia.</p>";
    return;
  }
  el.commentList.innerHTML = state.comments
    .slice()
    .reverse()
    .map((c) => {
      const date = new Date(c.createdAt).toLocaleString("es-ES");
      return `
        <article class="comment-item">
          <header><b>${esc(c.name)}</b><span>${esc(date)}</span></header>
          <p>${esc(c.text)}</p>
        </article>
      `;
    })
    .join("");
}

async function requestEpisodeFromLibrary(episodeNumber) {
  if (!state.anime) return;
  if (!window.YVAuth?.requireAuth("Inicia sesion para solicitar episodios.")) return;

  const safeEpisode = Math.max(1, Number(episodeNumber || currentEpisode()?.number || 1));
  const response = await requestJson(PROXY_LIBRARY_REQUEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      animeId: Number(state.anime.id || 0),
      episode: safeEpisode,
      searchMode: "AUTO"
    })
  });

  if (!response?.ok) {
    throw new Error(String(response?.error || "No se pudo solicitar el episodio"));
  }

  await refreshLibraryEpisodes({ silent: false });
}

function bindEvents() {
  el.serverTabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-server]");
    if (!btn) return;
    state.currentServer = btn.dataset.server;
    renderServerTabs();
    renderPlayer();
  });

  el.episodeList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-episode-index]");
    if (!btn) return;
    state.currentEpisodeIndex = Number(btn.dataset.episodeIndex);
    renderServerTabs();
    renderEpisodes();
    renderPlayer();
  });

  el.playerArea.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-request-episode]");
    if (!btn) return;
    const episode = Number(btn.dataset.requestEpisode || 0);
    btn.disabled = true;
    try {
      await requestEpisodeFromLibrary(episode);
      el.playerNote.textContent = `Solicitud enviada para episodio ${episode}.`;
    } catch (error) {
      el.playerNote.textContent = `No se pudo solicitar el episodio. ${error.message || ""}`;
      btn.disabled = false;
    }
  });

  el.episodeSearch.addEventListener("input", renderEpisodes);

  el.languageSelect.addEventListener("change", renderPlayer);

  el.commentForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = el.commentName.value.trim() || "Anonimo";
    const text = el.commentText.value.trim();
    if (!text) return;
    state.comments.push({ name, text, createdAt: Date.now() });
    saveComments();
    renderComments();
    el.commentText.value = "";
  });

  if (el.favoriteToggle) {
    el.favoriteToggle.addEventListener("click", async () => {
      if (!window.YVAuth?.requireAuth("Inicia sesion para guardar favoritos.")) return;
      await toggleList("favorites");
    });
  }

  if (el.pendingToggle) {
    el.pendingToggle.addEventListener("click", async () => {
      if (!window.YVAuth?.requireAuth("Inicia sesion para guardar pendientes.")) return;
      await toggleList("pending");
    });
  }

  window.addEventListener("beforeunload", stopLibraryPolling);
}

async function main() {
  if (window.YVAuth?.init) {
    await window.YVAuth.init();
    state.session = window.YVAuth.getSession();
    window.YVAuth.onChange(async (session) => {
      state.session = session;
      loadComments();
      renderComments();
      await loadProfileFlags();
      renderListButtons();
    });
  }

  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get("id") || 0);
  state.requestedEpisode = Math.max(1, Number(params.get("ep") || 1));
  if (!id) {
    el.animeTitle.textContent = "ID invalido";
    el.animeDescription.textContent = "No se recibio un id de anime.";
    return;
  }

  try {
    const data = await requestAniList(detailQuery, { id });
    const anime = data.Media;
    if (!anime) {
      el.animeTitle.textContent = "No encontrado";
      el.animeDescription.textContent = "No existe informacion para este anime.";
      return;
    }

    state.anime = await enhanceAnimeImageQuality(anime);
    state.synopsisEs = "Cargando sinopsis...";
    state.libraryEpisodes = await requestLibraryEpisodes(Number(state.anime.id || 0));
    rebuildEpisodesPreservingSelection();
    renderHeader();
    state.synopsisEs = await buildSpanishSynopsis(anime);
    renderHeader();
    await loadProfileFlags();
    renderListButtons();
    renderServerTabs();
    renderPlayer();
    renderEpisodes();
    loadComments();
    renderComments();
    bindEvents();
    startLibraryPolling();
  } catch (error) {
    el.animeTitle.textContent = "Error de carga";
    el.animeDescription.textContent = `No se pudo cargar el anime. ${error.message || ""}`;
  }
}

main();
