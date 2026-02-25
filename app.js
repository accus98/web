const DIRECT_ANILIST_URL = "https://graphql.anilist.co";
const PROXY_ANILIST_URL = "/api/anilist";
const PROXY_IMAGE_QUALITY_URL = "/api/image-quality";

const el = {
  nav: document.getElementById("nav"),
  menuBtn: document.getElementById("menuBtn"),
  headerSearchBtn: document.getElementById("headerSearchBtn"),
  authTrigger: document.getElementById("authTrigger"),
  logoutBtn: document.getElementById("logoutBtn"),
  profileLink: document.getElementById("profileLink"),
  hero: document.querySelector(".hero"),
  bg1: document.querySelector(".bg-1"),
  bg2: document.querySelector(".bg-2"),
  stats: document.getElementById("stats"),
  continueSection: document.getElementById("continuar"),
  continueClear: document.getElementById("continueClear"),
  continueGrid: document.getElementById("continueGrid"),
  recommendedSection: document.getElementById("para-ti"),
  recommendedGrid: document.getElementById("recommendedGrid"),
  trendingGrid: document.getElementById("trendingGrid"),
  quickFilters: document.getElementById("quickFilters"),
  globalGenre: document.getElementById("globalGenre"),
  globalStatus: document.getElementById("globalStatus"),
  globalScore: document.getElementById("globalScore"),
  globalApply: document.getElementById("globalApply"),
  globalClear: document.getElementById("globalClear"),
  seasonGrid: document.getElementById("seasonGrid"),
  topGrid: document.getElementById("topGrid"),
  genreCloud: document.getElementById("genreCloud"),
  searchShell: document.getElementById("searchShell"),
  searchInput: document.getElementById("searchInput"),
  searchBtn: document.getElementById("searchBtn"),
  searchResults: document.getElementById("searchResults"),
  modal: document.getElementById("modal"),
  modalClose: document.getElementById("modalClose"),
  modalBanner: document.getElementById("modalBanner"),
  modalBody: document.getElementById("modalBody")
};

const state = {
  rawTrending: [],
  rawSeason: [],
  rawTop: [],
  trending: [],
  season: [],
  top: [],
  genres: [],
  session: { authenticated: false },
  profile: {
    history: [],
    favorites: [],
    pending: [],
    stats: { history: 0, favorites: 0, pending: 0 }
  },
  globalFilter: { genre: "", status: "", score: "" },
  trendingFilter: "all",
  filterRequestId: 0,
  imageEnhanceRequestId: 0,
  searchRows: []
};

const imageQualityCache = new Map();
const imageMetaCache = new Map();
let heroCycleTimer = null;
let heroCycleToken = 0;
let searchHeroToken = 0;
let anilistProxyBackoffUntil = 0;
const CONTINUE_KEY = "yv_continue_v1";
const MAX_CONTINUE_ITEMS = 24;

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

const GENRE_MAP = {
  Action: "Accion",
  Adventure: "Aventura",
  Comedy: "Comedia",
  Drama: "Drama",
  Ecchi: "Ecchi",
  Fantasy: "Fantasia",
  Hentai: "Hentai",
  Horror: "Terror",
  "Mahou Shoujo": "Magica",
  Mecha: "Mecha",
  Music: "Musica",
  Mystery: "Misterio",
  Psychological: "Psicologico",
  Romance: "Romance",
  "Sci-Fi": "Ciencia ficcion",
  "Slice of Life": "Recuentos de la vida",
  Sports: "Deportes",
  Supernatural: "Sobrenatural",
  Thriller: "Suspenso"
};

const homeQuery = `
query HomePageData($season: MediaSeason, $seasonYear: Int) {
  trending: Page(page: 1, perPage: 12) {
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
  season: Page(page: 1, perPage: 6) {
    media(type: ANIME, sort: POPULARITY_DESC, season: $season, seasonYear: $seasonYear) {
      id
      idMal
      title { romaji english native }
      averageScore
      season
      seasonYear
      status
      genres
      coverImage { extraLarge large medium }
      bannerImage
    }
  }
  top: Page(page: 1, perPage: 10) {
    media(type: ANIME, sort: SCORE_DESC) {
      id
      idMal
      title { romaji english native }
      averageScore
      episodes
      seasonYear
      status
      genres
      coverImage { extraLarge large medium }
    }
  }
  genres: GenreCollection
}
`;

const filteredQuery = `
query FilteredHome(
  $genre: String
  $status: MediaStatus
  $score: Int
  $season: MediaSeason
  $seasonYear: Int
) {
  trending: Page(page: 1, perPage: 24) {
    media(
      type: ANIME
      sort: TRENDING_DESC
      genre: $genre
      status: $status
      averageScore_greater: $score
    ) {
      id
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
  season: Page(page: 1, perPage: 24) {
    media(
      type: ANIME
      sort: POPULARITY_DESC
      season: $season
      seasonYear: $seasonYear
      genre: $genre
      status: $status
      averageScore_greater: $score
    ) {
      id
      title { romaji english native }
      averageScore
      season
      seasonYear
      status
      genres
      coverImage { extraLarge large medium }
      bannerImage
    }
  }
  top: Page(page: 1, perPage: 24) {
    media(
      type: ANIME
      sort: SCORE_DESC
      genre: $genre
      status: $status
      averageScore_greater: $score
    ) {
      id
      title { romaji english native }
      averageScore
      episodes
      seasonYear
      status
      genres
      coverImage { extraLarge large medium }
    }
  }
}
`;

const searchQuery = `
query SearchAnime($search: String) {
  Page(page: 1, perPage: 12) {
    media(type: ANIME, sort: POPULARITY_DESC, search: $search) {
      id
      idMal
      title { romaji english native }
      averageScore
      seasonYear
      episodes
      coverImage { extraLarge large medium }
      bannerImage
    }
  }
}
`;

const detailQuery = `
query Detail($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    description(asHtml: false)
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
  }
}
`;

function nowSeason() {
  const d = new Date();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  let season = "WINTER";
  if (month >= 3 && month <= 5) season = "SPRING";
  if (month >= 6 && month <= 8) season = "SUMMER";
  if (month >= 9 && month <= 11) season = "FALL";
  return { season, seasonYear: year };
}

async function requestAniList(query, variables = {}) {
  const requestAniListFrom = async (url) => {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error = new Error(`AniList ${r.status}`);
      error.status = Number(r.status || 0);
      error.payload = json;
      throw error;
    }
    if (json.errors) throw new Error(json.errors[0]?.message || "GraphQL error");
    return json.data;
  };

  if (window.location.protocol === "file:") {
    return requestAniListFrom(DIRECT_ANILIST_URL);
  }

  try {
    if (Date.now() < anilistProxyBackoffUntil) {
      const waitError = new Error("AniList 429");
      waitError.status = 429;
      throw waitError;
    }
    return await requestAniListFrom(PROXY_ANILIST_URL);
  } catch (error) {
    const status = Number(error?.status || 0);
    if (status === 429) {
      anilistProxyBackoffUntil = Date.now() + 4500;
    }
    throw error;
  }
}

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cssUrl(url) {
  return String(url || "").replace(/'/g, "%27");
}

function setHeroImage(url) {
  if (!url) return;
  el.hero.style.setProperty("--hero-bg", `url('${cssUrl(url)}')`);
}

function pickTitle(title) {
  return title?.english || title?.romaji || title?.native || "Anime";
}

function bestCover(coverImage) {
  return coverImage?.extraLarge || coverImage?.large || coverImage?.medium || "";
}

function coverSrcSet(coverImage) {
  const parts = [];
  const seen = new Set();
  const candidates = [
    [coverImage?.medium, 240],
    [coverImage?.large, 460],
    [coverImage?.extraLarge, 680]
  ];
  candidates.forEach(([url, width]) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    parts.push(`${esc(url)} ${width}w`);
  });
  return parts.join(", ");
}

function uniqueUrls(list, max = 12) {
  const out = [];
  const seen = new Set();
  (list || []).forEach((url) => {
    const value = String(url || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out.slice(0, max);
}

function loadImageMeta(url) {
  const key = String(url || "").trim();
  if (!key) return Promise.resolve({ width: 0, height: 0 });
  if (imageMetaCache.has(key)) return imageMetaCache.get(key);

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

  imageMetaCache.set(key, promise);
  return promise;
}

function scoreHeroCandidate(item) {
  const width = Number(item?.width || 0);
  const height = Number(item?.height || 0);
  if (!width || !height) return 0;
  const area = width * height;
  const ratio = width / Math.max(1, height);
  const ratioPenalty = Math.min(1, Math.abs(ratio - 1.78));
  const bannerBoost = item.kind === "banner" ? 220_000 : 0;
  const hdBoost = width >= 1900 ? 320_000 : width >= 1500 ? 190_000 : width >= 1200 ? 95_000 : 0;
  const penalty = ratioPenalty * 180_000;
  return area + bannerBoost + hdBoost - penalty;
}

async function pickHeroImages(animes) {
  const bannerCandidates = uniqueUrls((animes || []).map((a) => a.bannerImage), 24);
  const coverCandidates = uniqueUrls((animes || []).map((a) => bestCover(a.coverImage)), 24);
  const combined = [
    ...bannerCandidates.map((url) => ({ url, kind: "banner" })),
    ...coverCandidates.map((url) => ({ url, kind: "cover" }))
  ];
  if (!combined.length) return [];

  const checked = await Promise.all(
    combined.map(async (item) => ({
      ...item,
      ...(await loadImageMeta(item.url))
    }))
  );

  const ranked = checked
    .map((item) => ({ ...item, score: scoreHeroCandidate(item) }))
    .filter((item) => item.width >= 960 && item.height >= 340)
    .sort((a, b) => b.score - a.score);
  if (ranked.length) {
    return uniqueUrls(ranked.map((item) => item.url), 10);
  }

  const fallback = checked
    .filter((item) => item.width >= 760 && item.height >= 280)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .map((item) => item.url);
  if (fallback.length) return uniqueUrls(fallback, 10);

  return uniqueUrls(combined.map((item) => item.url), 10);
}

function canUseProxyApis() {
  return window.location.protocol !== "file:";
}

function collectUniqueMalIds(...lists) {
  const out = [];
  const seen = new Set();
  lists
    .flat()
    .forEach((anime) => {
      const idMal = Number(anime?.idMal || 0);
      if (!idMal || seen.has(idMal)) return;
      seen.add(idMal);
      out.push(idMal);
    });
  return out;
}

function mergeBestImageIntoAnime(anime, best) {
  if (!best || (!best.cover && !best.banner)) return anime;
  const next = {
    ...anime,
    coverImage: {
      extraLarge: anime?.coverImage?.extraLarge || "",
      large: anime?.coverImage?.large || "",
      medium: anime?.coverImage?.medium || ""
    }
  };

  if (best.cover) {
    next.coverImage.extraLarge = best.cover;
    next.coverImage.large = best.cover;
    if (!next.coverImage.medium) next.coverImage.medium = best.cover;
  }
  if (best.banner) {
    next.bannerImage = best.banner;
  }
  return next;
}

function applyImageMapToList(list, imageMap) {
  return (list || []).map((anime) => {
    const idMal = Number(anime?.idMal || 0);
    if (!idMal) return anime;
    return mergeBestImageIntoAnime(anime, imageMap.get(idMal));
  });
}

async function requestImageQualityMap(idMals) {
  const ids = [];
  const seen = new Set();
  (idMals || []).forEach((raw) => {
    const id = Number(raw || 0);
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  if (!ids.length || !canUseProxyApis()) return new Map();

  const missing = ids.filter((id) => !imageQualityCache.has(id));
  if (missing.length) {
    try {
      const r = await fetch(PROXY_IMAGE_QUALITY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ ids: missing })
      });
      if (r.ok) {
        const json = await r.json();
        (json?.items || []).forEach((item) => {
          const idMal = Number(item?.idMal || 0);
          if (!idMal) return;
          imageQualityCache.set(idMal, item);
        });
      }
    } catch {}
  }

  const map = new Map();
  ids.forEach((id) => {
    if (imageQualityCache.has(id)) {
      map.set(id, imageQualityCache.get(id));
    }
  });
  return map;
}

async function enhanceCurrentListsImageQuality() {
  const reqId = ++state.imageEnhanceRequestId;
  const ids = collectUniqueMalIds(state.trending, state.season, state.top);
  if (!ids.length || !canUseProxyApis()) return;

  const imageMap = await requestImageQualityMap(ids);
  if (reqId !== state.imageEnhanceRequestId || !imageMap.size) return;

  state.rawTrending = applyImageMapToList(state.rawTrending, imageMap);
  state.rawSeason = applyImageMapToList(state.rawSeason, imageMap);
  state.rawTop = applyImageMapToList(state.rawTop, imageMap);
  state.trending = applyImageMapToList(state.trending, imageMap);
  state.season = applyImageMapToList(state.season, imageMap);
  state.top = applyImageMapToList(state.top, imageMap);
  renderAllSections();
  setupBackgroundCycle(state.trending);
}

async function enhanceSearchRowsImageQuality(rows) {
  const ids = collectUniqueMalIds(rows);
  if (!ids.length || !canUseProxyApis()) return rows;
  const imageMap = await requestImageQualityMap(ids);
  if (!imageMap.size) return rows;
  return applyImageMapToList(rows, imageMap);
}

function toStatus(value) {
  return STATUS_MAP[value] || value || "-";
}

function toSeason(value) {
  return SEASON_MAP[value] || value || "-";
}

function toGenre(value) {
  return GENRE_MAP[value] || value;
}

function cleanDescription(text) {
  return String(text || "Sin sinopsis disponible.")
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

async function loadRemoteProfile() {
  if (!isAuthenticated()) {
    state.profile = {
      history: [],
      favorites: [],
      pending: [],
      stats: { history: 0, favorites: 0, pending: 0 }
    };
    return;
  }

  try {
    const json = await requestJson("/api/profile/me");
    state.profile = json?.profile || {
      history: [],
      favorites: [],
      pending: [],
      stats: { history: 0, favorites: 0, pending: 0 }
    };
  } catch {
    state.profile = {
      history: [],
      favorites: [],
      pending: [],
      stats: { history: 0, favorites: 0, pending: 0 }
    };
  }
}

function parseLocalContinueHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTINUE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => ({
        animeId: Number(entry?.animeId || 0),
        idMal: Number(entry?.idMal || 0),
        title: String(entry?.title || "").trim(),
        cover: String(entry?.cover || "").trim(),
        banner: String(entry?.banner || "").trim(),
        episodeNumber: Math.max(1, Number(entry?.episodeNumber || 1)),
        episodeTitle: String(entry?.episodeTitle || "").trim(),
        totalEpisodes: Math.max(0, Number(entry?.totalEpisodes || 0)),
        updatedAt: Number(entry?.updatedAt || 0),
        status: String(entry?.status || "").trim(),
        score: Number(entry?.score || 0),
        genres: Array.isArray(entry?.genres)
          ? entry.genres.map((g) => String(g || "").trim()).filter(Boolean)
          : []
      }))
      .filter((entry) => entry.animeId && entry.title)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONTINUE_ITEMS);
  } catch {
    return [];
  }
}

function parseRemoteContinueHistory() {
  const raw = Array.isArray(state.profile?.history) ? state.profile.history : [];
  return raw
    .map((entry) => ({
      animeId: Number(entry?.animeId || 0),
      idMal: Number(entry?.idMal || 0),
      title: String(entry?.title || "").trim(),
      cover: String(entry?.cover || "").trim(),
      banner: String(entry?.banner || "").trim(),
      episodeNumber: Math.max(1, Number(entry?.episodeNumber || 1)),
      episodeTitle: String(entry?.episodeTitle || "").trim(),
      totalEpisodes: Math.max(0, Number(entry?.totalEpisodes || entry?.episodes || 0)),
      updatedAt: Number(entry?.updatedAt || 0),
      status: String(entry?.status || "").trim(),
      score: Number(entry?.score || 0),
      genres: Array.isArray(entry?.genres)
        ? entry.genres.map((g) => String(g || "").trim()).filter(Boolean)
        : []
    }))
    .filter((entry) => entry.animeId && entry.title)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONTINUE_ITEMS);
}

function parseContinueHistory() {
  return isAuthenticated() ? parseRemoteContinueHistory() : parseLocalContinueHistory();
}

function formatTimeAgo(ts) {
  const time = Number(ts || 0);
  if (!time) return "Ahora";
  const diff = Math.max(0, Date.now() - time);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Ahora";
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days} d`;
}

function continueCardTemplate(item) {
  const title = esc(item.title);
  const episodeLabel = item.episodeTitle
    ? esc(item.episodeTitle)
    : `Episodio ${item.episodeNumber}`;
  const total = Number(item.totalEpisodes || 0);
  const progress = total > 0
    ? Math.max(4, Math.min(100, Math.round((item.episodeNumber / total) * 100)))
    : Math.max(6, Math.min(100, item.episodeNumber * 7));
  const bg = item.banner || item.cover || "";
  return `
    <article class="continue-card reveal" data-id="${item.animeId}" data-ep="${item.episodeNumber}" style="--continue-bg:url('${cssUrl(bg)}')">
      <div class="continue-body">
        <div class="continue-top">
          <span class="continue-badge">Seguir</span>
          <span class="continue-time">${esc(formatTimeAgo(item.updatedAt))}</span>
        </div>
        <h3 class="continue-title">${title}</h3>
        <p class="continue-episode">Vas por: ${episodeLabel}</p>
        <div class="continue-progress">
          <small>${total > 0 ? `${item.episodeNumber}/${total} episodios` : `${item.episodeNumber} episodios vistos`}</small>
          <div class="continue-progress-track">
            <span class="continue-progress-fill" style="width:${progress}%"></span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderContinueSection() {
  const list = parseContinueHistory();
  if (!list.length) {
    el.continueSection.hidden = true;
    el.continueGrid.innerHTML = "";
    return list;
  }
  el.continueSection.hidden = false;
  el.continueGrid.innerHTML = list.map(continueCardTemplate).join("");
  return list;
}

function dedupeAnimeList(list) {
  const out = [];
  const seen = new Set();
  (list || []).forEach((anime) => {
    const id = Number(anime?.id || 0);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(anime);
  });
  return out;
}

function renderRecommendedSection(history) {
  const favorites = Array.isArray(state.profile?.favorites) ? state.profile.favorites : [];
  const pending = Array.isArray(state.profile?.pending) ? state.profile.pending : [];
  const favoriteIds = new Set(
    favorites
      .map((item) => Number(item?.animeId || 0))
      .filter(Boolean)
  );
  const pendingIds = new Set(
    pending
      .map((item) => Number(item?.animeId || 0))
      .filter(Boolean)
  );
  const watchedIds = new Set(
    [...(history || []), ...favorites, ...pending]
      .map((item) => Number(item.animeId || 0))
      .filter(Boolean)
  );
  const genreWeight = new Map();
  const historyAndLists = [...(history || []), ...favorites, ...pending];
  historyAndLists.forEach((item, idx) => {
    const weight = Math.max(1, 6 - idx);
    (item.genres || []).forEach((genre) => {
      genreWeight.set(genre, (genreWeight.get(genre) || 0) + weight);
    });
  });

  const pool = dedupeAnimeList([...state.trending, ...state.season, ...state.top]);
  if (!pool.length || !genreWeight.size) {
    el.recommendedSection.hidden = true;
    el.recommendedGrid.innerHTML = "";
    return;
  }

  const ranked = pool
    .filter((anime) => !watchedIds.has(Number(anime?.id || 0)))
    .map((anime) => {
      const genreScore = (anime.genres || []).reduce((acc, genre) => acc + (genreWeight.get(genre) || 0), 0);
      const score = Number(anime.averageScore || 0);
      const statusBoost = anime.status === "RELEASING" ? 4 : 0;
      return { anime, rank: genreScore * 10 + score + statusBoost };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 8)
    .map((item) => item.anime);

  if (!ranked.length) {
    el.recommendedSection.hidden = true;
    el.recommendedGrid.innerHTML = "";
    return;
  }

  el.recommendedSection.hidden = false;
  el.recommendedGrid.innerHTML = ranked
    .map((anime) => cardTemplate(anime, pendingIds, favoriteIds))
    .join("");
}

function renderPersonalizedSections() {
  const history = renderContinueSection();
  renderRecommendedSection(history);
  // Estas secciones se re-renderizan en eventos de foco/almacenamiento;
  // volvemos a enganchar lazy loading y reveal para evitar tarjetas invisibles.
  lazyLoadImages();
  initReveal();
}

function setSkeleton(target, count, className = "skeleton") {
  target.innerHTML = Array.from({ length: count }).map(() => `<div class="${className}"></div>`).join("");
}

function passGlobalFilter(anime) {
  const f = state.globalFilter;
  if (f.genre && !(anime.genres || []).includes(f.genre)) return false;
  if (f.status && anime.status !== f.status) return false;
  if (f.score && Number(anime.averageScore || 0) < Number(f.score)) return false;
  return true;
}

function getProfileAnimeIdSet(listName) {
  const list = Array.isArray(state.profile?.[listName]) ? state.profile[listName] : [];
  return new Set(
    list
      .map((item) => Number(item?.animeId || 0))
      .filter(Boolean)
  );
}

function buildProfileAnimePayload(anime) {
  const animeId = Number(anime?.id || 0);
  if (!animeId) return null;
  return {
    animeId,
    idMal: Number(anime?.idMal || 0),
    title: pickTitle(anime?.title),
    cover: bestCover(anime?.coverImage),
    banner: String(anime?.bannerImage || "").trim(),
    score: Number(anime?.averageScore || 0),
    status: String(anime?.status || "").trim(),
    episodes: Number(anime?.episodes || 0),
    seasonYear: Number(anime?.seasonYear || 0),
    genres: Array.isArray(anime?.genres) ? anime.genres.slice(0, 8) : []
  };
}

function findLoadedAnimeById(animeId) {
  const id = Number(animeId || 0);
  if (!id) return null;
  const pool = dedupeAnimeList([
    ...state.searchRows,
    ...state.trending,
    ...state.season,
    ...state.top,
    ...state.rawTrending,
    ...state.rawSeason,
    ...state.rawTop
  ]);
  return pool.find((anime) => Number(anime?.id || 0) === id) || null;
}

function hasGlobalFilterActive() {
  const f = state.globalFilter;
  return Boolean(f.genre || f.status || f.score);
}

async function fetchFilteredData() {
  const reqId = ++state.filterRequestId;
  const seasonInfo = nowSeason();
  const escapeGraphQLString = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const args = [];
  if (state.globalFilter.genre) args.push(`genre: "${escapeGraphQLString(state.globalFilter.genre)}"`);
  if (state.globalFilter.status) args.push(`status: ${state.globalFilter.status}`);
  if (state.globalFilter.score) args.push(`averageScore_greater: ${Number(state.globalFilter.score)}`);
  const optionalArgs = args.length ? `, ${args.join(", ")}` : "";

  const query = `
  query FilteredHome {
    trending: Page(page: 1, perPage: 24) {
      media(type: ANIME, sort: TRENDING_DESC${optionalArgs}) {
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
    season: Page(page: 1, perPage: 24) {
      media(type: ANIME, sort: POPULARITY_DESC, season: ${seasonInfo.season}, seasonYear: ${seasonInfo.seasonYear}${optionalArgs}) {
        id
        idMal
        title { romaji english native }
        averageScore
        season
        seasonYear
        status
        genres
        coverImage { extraLarge large medium }
        bannerImage
      }
    }
    top: Page(page: 1, perPage: 24) {
      media(type: ANIME, sort: SCORE_DESC${optionalArgs}) {
        id
        idMal
        title { romaji english native }
        averageScore
        episodes
        seasonYear
        status
        genres
        coverImage { extraLarge large medium }
      }
    }
  }
  `;

  const data = await requestAniList(query);
  if (reqId !== state.filterRequestId) return null;
  return data;
}

function maxScoreOf(list) {
  return list.reduce((max, anime) => Math.max(max, Number(anime.averageScore || 0)), 0);
}

function noResultsText(sectionName, sourceList) {
  const score = Number(state.globalFilter.score || 0);
  if (score > 0) {
    const max = maxScoreOf(sourceList);
    if (max > 0) {
      return `No hay resultados en ${sectionName} para score ${score}. Max actual: ${max}.`;
    }
  }
  return "No hay resultados para este filtro.";
}

function filterTrending(list, filter) {
  if (filter === "airing") return list.filter((a) => a.status === "RELEASING");
  if (filter === "score80") return list.filter((a) => Number(a.averageScore || 0) >= 80);
  if (filter === "action") return list.filter((a) => (a.genres || []).includes("Action"));
  if (filter === "romance") return list.filter((a) => (a.genres || []).includes("Romance"));
  return list;
}

function renderTrending() {
  const favoriteIds = getProfileAnimeIdSet("favorites");
  const pendingIds = getProfileAnimeIdSet("pending");
  const filtered = filterTrending(state.trending, state.trendingFilter).filter(passGlobalFilter);
  el.trendingGrid.innerHTML = filtered.length
    ? filtered.map((anime) => cardTemplate(anime, pendingIds, favoriteIds)).join("")
    : `<p>${noResultsText("tendencias", state.trending)}</p>`;
  lazyLoadImages();
  initReveal();
}

function renderSeason() {
  const favoriteIds = getProfileAnimeIdSet("favorites");
  const pendingIds = getProfileAnimeIdSet("pending");
  const filtered = state.season.filter(passGlobalFilter);
  el.seasonGrid.innerHTML = filtered.length
    ? filtered.map((anime) => seasonTemplate(anime, pendingIds, favoriteIds)).join("")
    : `<p>${noResultsText("temporada", state.season)}</p>`;
}

function renderTop() {
  const filtered = state.top.filter(passGlobalFilter);
  el.topGrid.innerHTML = filtered.length
    ? filtered.map(topTemplate).join("")
    : `<p>${noResultsText("top", state.top)}</p>`;
}

function renderAllSections() {
  renderTrending();
  renderSeason();
  renderTop();
  renderPersonalizedSections();
  lazyLoadImages();
  initReveal();
}

function hydrateGlobalGenres() {
  const value = el.globalGenre.value;
  el.globalGenre.innerHTML =
    `<option value="">Genero</option>` +
    state.genres.map((g) => `<option value="${esc(g)}">${esc(toGenre(g))}</option>`).join("");
  if (value) el.globalGenre.value = value;
}

function cardSaveActionsTemplate(anime, pendingIds, favoriteIds) {
  const animeId = Number(anime?.id || 0);
  if (!animeId) return "";
  const title = pickTitle(anime?.title);
  const pendingActive = pendingIds?.has(animeId);
  const favoriteActive = favoriteIds?.has(animeId);
  const pendingLabel = pendingActive
    ? `Quitar ${title} de ver mas tarde`
    : `Guardar ${title} para ver mas tarde`;
  const favoriteLabel = favoriteActive
    ? `Quitar ${title} de favoritos`
    : `Guardar ${title} en favoritos`;
  return `
    <div class="card-save-actions">
      <button
        class="card-save-btn ${favoriteActive ? "active" : ""}"
        type="button"
        data-card-save="favorites"
        data-anime-id="${animeId}"
        aria-pressed="${favoriteActive ? "true" : "false"}"
        aria-label="${esc(favoriteLabel)}"
        title="${esc(favoriteLabel)}"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 21s-6.7-4.4-9.2-7.1c-2.5-2.8-2.5-7 .2-9.8a5.55 5.55 0 0 1 7.9 0L12 5.2l1.1-1.1a5.55 5.55 0 0 1 7.9 0c2.7 2.8 2.7 7 .2 9.8C18.7 16.6 12 21 12 21z"></path>
        </svg>
      </button>
      <button
        class="card-save-btn ${pendingActive ? "active" : ""}"
        type="button"
        data-card-save="pending"
        data-anime-id="${animeId}"
        aria-pressed="${pendingActive ? "true" : "false"}"
        aria-label="${esc(pendingLabel)}"
        title="${esc(pendingLabel)}"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"></path>
        </svg>
      </button>
    </div>
  `;
}

function cardTemplate(anime, pendingIds = null, favoriteIds = null) {
  const title = esc(pickTitle(anime.title));
  const image = bestCover(anime.coverImage);
  const srcset = coverSrcSet(anime.coverImage);
  return `
  <article class="card reveal" data-id="${anime.id}">
    ${cardSaveActionsTemplate(anime, pendingIds, favoriteIds)}
    <img data-src="${esc(image)}" data-srcset="${srcset}" data-sizes="(max-width: 760px) 50vw, (max-width: 1200px) 25vw, 280px" alt="${title}" loading="lazy" />
    <div class="card-body">
      <h3>${title}</h3>
      <div class="meta">
        <span>${anime.averageScore ? `Score ${anime.averageScore}` : "Sin score"}</span>
        <span>${anime.episodes ? `${anime.episodes} eps` : "Por confirmar"}</span>
        <span>${toStatus(anime.status)}</span>
      </div>
    </div>
  </article>`;
}

function seasonTemplate(anime, pendingIds = null, favoriteIds = null) {
  const title = esc(pickTitle(anime.title));
  const image = anime.bannerImage || bestCover(anime.coverImage);
  const srcset = coverSrcSet(anime.coverImage);
  return `
  <article class="card reveal" data-id="${anime.id}">
    ${cardSaveActionsTemplate(anime, pendingIds, favoriteIds)}
    <img data-src="${esc(image)}" data-srcset="${srcset}" data-sizes="(max-width: 980px) 100vw, 33vw" alt="${title}" loading="lazy" />
    <div class="card-body">
      <h3>${title}</h3>
      <div class="meta">
        <span>${toSeason(anime.season)} ${anime.seasonYear || ""}</span>
        <span>${anime.averageScore ? `Score ${anime.averageScore}` : "Nuevo"}</span>
      </div>
    </div>
  </article>`;
}

function topTemplate(anime, idx) {
  const title = esc(pickTitle(anime.title));
  const image = bestCover(anime.coverImage);
  const srcset = coverSrcSet(anime.coverImage);
  return `
  <article class="rank reveal" data-id="${anime.id}">
    <div class="rank-num">${idx + 1}</div>
    <img data-src="${esc(image)}" data-srcset="${srcset}" data-sizes="66px" alt="${title}" loading="lazy" />
    <div>
      <h3>${title}</h3>
      <div class="meta">
        <span>${anime.averageScore ? `Score ${anime.averageScore}` : "Sin score"}</span>
        <span>${anime.episodes ? `${anime.episodes} eps` : "Por confirmar"}</span>
        <span>${anime.seasonYear || "-"}</span>
      </div>
    </div>
  </article>`;
}

function searchItemTemplate(anime, idx = 0) {
  const title = esc(pickTitle(anime.title));
  const image = bestCover(anime.coverImage);
  const srcset = coverSrcSet(anime.coverImage);
  const delay = Math.max(0, Math.min(7, Number(idx || 0))) * 34;
  const animeId = Number(anime?.id || 0);
  const externalUrl = String(anime?.externalUrl || "").trim();
  const targetAttr = animeId > 0
    ? `data-id="${animeId}"`
    : (externalUrl ? `data-external="${esc(externalUrl)}"` : "");
  return `
  <article class="search-item" ${targetAttr} style="--si-delay:${delay}ms">
    <img data-src="${esc(image)}" data-srcset="${srcset}" data-sizes="58px" alt="${title}" loading="lazy" />
    <div>
      <h3>${title}</h3>
      <div class="meta">
        <span>${anime.averageScore ? `Score ${anime.averageScore}` : "Sin score"}</span>
        <span>${anime.seasonYear || "-"}</span>
      </div>
    </div>
  </article>`;
}

function renderStats(trending) {
  const avg = Math.round(trending.reduce((acc, a) => acc + (a.averageScore || 0), 0) / Math.max(trending.length, 1));
  const episodes = trending.reduce((acc, a) => acc + (a.episodes || 0), 0);
  el.stats.innerHTML = `
    <div class="stat"><b>${trending.length}</b><span>Titulos destacados</span></div>
    <div class="stat"><b>${avg || "-"}</b><span>Score promedio</span></div>
    <div class="stat"><b>${episodes || "-"}</b><span>Episodios sumados</span></div>
  `;
}

function renderGenreCloud(genres) {
  el.genreCloud.innerHTML = genres
    .slice(0, 20)
    .map((g) => `<span class="genre-pill reveal">${esc(toGenre(g))}</span>`)
    .join("");
}

function lazyLoadImages() {
  const images = document.querySelectorAll("img[data-src]");
  const io = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      img.src = img.dataset.src;
      if (img.dataset.srcset) img.srcset = img.dataset.srcset;
      if (img.dataset.sizes) img.sizes = img.dataset.sizes;
      img.removeAttribute("data-src");
      img.removeAttribute("data-srcset");
      img.removeAttribute("data-sizes");
      observer.unobserve(img);
    });
  }, { rootMargin: "120px" });
  images.forEach((img) => io.observe(img));
}

function initReveal() {
  const items = document.querySelectorAll(".reveal");
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  items.forEach((item, i) => {
    item.style.transitionDelay = `${(i % 8) * 35}ms`;
    io.observe(item);
  });
}

async function setupBackgroundCycle(animes) {
  const cycleToken = ++heroCycleToken;
  const images = await pickHeroImages(animes);
  if (cycleToken !== heroCycleToken) return;
  if (!images.length) return;

  setHeroImage(images[0]);

  el.bg1.style.backgroundImage = `url('${cssUrl(images[0])}')`;
  el.bg1.style.opacity = "0.3";
  el.bg2.style.opacity = "0";

  if (heroCycleTimer) {
    clearInterval(heroCycleTimer);
    heroCycleTimer = null;
  }

  let i = 0;
  let second = false;
  heroCycleTimer = setInterval(() => {
    i = (i + 1) % images.length;
    setHeroImage(images[i]);
    if (second) {
      el.bg1.style.backgroundImage = `url('${cssUrl(images[i])}')`;
      el.bg1.style.opacity = "0.3";
      el.bg2.style.opacity = "0";
    } else {
      el.bg2.style.backgroundImage = `url('${cssUrl(images[i])}')`;
      el.bg2.style.opacity = "0.26";
      el.bg1.style.opacity = "0";
    }
    second = !second;
  }, 5400);
}

function stopHeroCycle() {
  if (heroCycleTimer) {
    clearInterval(heroCycleTimer);
    heroCycleTimer = null;
  }
  heroCycleToken += 1;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function animeTitleCandidates(anime) {
  const title = anime?.title || {};
  return [title.romaji, title.english, title.native]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);
}

function pickSearchFocusAnime(rows, term) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const needle = normalizeSearchText(term);
  if (!needle) return rows[0] || null;

  const scored = rows
    .map((anime) => {
      const titles = animeTitleCandidates(anime);
      let score = 0;
      titles.forEach((t) => {
        if (t === needle) score = Math.max(score, 100);
        else if (t.startsWith(needle)) score = Math.max(score, 70);
        else if (t.includes(needle)) score = Math.max(score, 45);
      });
      score += Number(anime?.averageScore || 0) / 100;
      return { anime, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.anime || rows[0] || null;
}

function restoreDefaultHeroFromHome() {
  searchHeroToken += 1;
  if (state.trending.length) {
    setupBackgroundCycle(state.trending);
  }
}

async function syncHeroWithSearch(rows, term) {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm || !Array.isArray(rows) || !rows.length) {
    restoreDefaultHeroFromHome();
    return;
  }

  const token = ++searchHeroToken;
  stopHeroCycle();

  const focusAnime = pickSearchFocusAnime(rows, normalizedTerm);
  const immediateImage = String(focusAnime?.bannerImage || bestCover(focusAnime?.coverImage) || "").trim();
  if (immediateImage) {
    setHeroImage(immediateImage);
  }

  const prioritized = focusAnime ? [focusAnime, ...rows.filter((item) => item !== focusAnime)] : rows;
  const candidates = await pickHeroImages(prioritized);
  if (token !== searchHeroToken) return;

  const heroImage = String(candidates[0] || immediateImage || "").trim();
  if (heroImage) {
    setHeroImage(heroImage);
  }
}

function searchAnimeById(id) {
  const animeId = Number(id || 0);
  if (!animeId) return null;
  return state.searchRows.find((anime) => Number(anime?.id || 0) === animeId) || null;
}

async function previewSearchHoverHero(animeId) {
  const anime = searchAnimeById(animeId);
  if (!anime) return;
  const token = ++searchHeroToken;
  stopHeroCycle();

  const immediate = String(anime.bannerImage || bestCover(anime.coverImage) || "").trim();
  if (immediate) {
    setHeroImage(immediate);
  }

  const candidates = await pickHeroImages([anime]);
  if (token !== searchHeroToken) return;

  const heroImage = String(candidates[0] || immediate || "").trim();
  if (heroImage) {
    setHeroImage(heroImage);
  }
}

function restoreHeroFromActiveSearch() {
  activeSearchHoverId = 0;
  if (!state.searchRows.length) {
    restoreDefaultHeroFromHome();
    return;
  }
  void syncHeroWithSearch(state.searchRows, el.searchInput.value.trim());
}

function openAnimeTab(id, episode = 0) {
  const params = new URLSearchParams();
  params.set("id", String(id));
  const ep = Number(episode || 0);
  if (ep > 0) params.set("ep", String(ep));
  const url = `anime.html?${params.toString()}`;
  window.open(url, "_blank", "noopener");
}

let searchTimer = null;
let globalFilterTimer = null;
let clearSearchTimer = null;
let activeSearchHoverId = 0;
let searchRequestId = 0;
let lastResolvedSearchTerm = "";
const searchResultsCache = new Map();
const SEARCH_CACHE_TTL_MS = 6 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 220;
const SEARCH_REMOTE_MIN_CHARS = 3;

function openSearchResults() {
  if (!el.searchResults) return;
  if (clearSearchTimer) {
    clearTimeout(clearSearchTimer);
    clearSearchTimer = null;
  }
  el.searchResults.classList.add("is-open");
}

function closeSearchResults(clear = false) {
  if (!el.searchResults) return;
  el.searchResults.classList.remove("is-open");
  if (!clear) return;
  if (clearSearchTimer) clearTimeout(clearSearchTimer);
  clearSearchTimer = setTimeout(() => {
    el.searchResults.innerHTML = "";
  }, 170);
}

function renderSearchMessage(message) {
  el.searchResults.innerHTML = `<p class="search-feedback">${esc(message)}</p>`;
  openSearchResults();
}

function getCachedSearchRows(term) {
  const key = normalizeSearchText(term);
  if (!key) return null;
  const entry = searchResultsCache.get(key);
  if (!entry) return null;
  if (Date.now() - Number(entry.ts || 0) > SEARCH_CACHE_TTL_MS) {
    searchResultsCache.delete(key);
    return null;
  }
  return Array.isArray(entry.rows) ? entry.rows : null;
}

function setCachedSearchRows(term, rows) {
  const key = normalizeSearchText(term);
  if (!key || !Array.isArray(rows) || !rows.length) return;
  searchResultsCache.set(key, { rows, ts: Date.now() });
}

function renderSearchRows(rows, term, reqId) {
  if (reqId !== searchRequestId) return false;
  const nextRows = Array.isArray(rows) ? rows.slice(0, 8) : [];
  state.searchRows = nextRows;
  lastResolvedSearchTerm = normalizeSearchText(term);
  activeSearchHoverId = 0;
  if (!nextRows.length) {
    el.searchResults.innerHTML = "";
    return false;
  }
  el.searchResults.innerHTML = nextRows.map((row, idx) => searchItemTemplate(row, idx)).join("");
  openSearchResults();
  lazyLoadImages();
  void syncHeroWithSearch(nextRows, term);
  return true;
}

function clearSearchResults() {
  activeSearchHoverId = 0;
  closeSearchResults(true);
}

function fallbackSearchFromLoadedData(term) {
  const needle = normalizeSearchText(term);
  if (!needle) return [];
  const pool = dedupeAnimeList([...state.trending, ...state.season, ...state.top]);
  return pool
    .filter((anime) => animeTitleCandidates(anime).some((title) => title.includes(needle)))
    .sort((a, b) => Number(b?.averageScore || 0) - Number(a?.averageScore || 0))
    .slice(0, 10);
}

function mapJikanSearchItem(item) {
  const idMal = Number(item?.mal_id || 0);
  const titleEnglish = String(item?.title_english || "").trim();
  const titleRomaji = String(item?.title || "").trim();
  const titleNative = String(item?.title_japanese || "").trim();
  const score = Number(item?.score || 0);
  const year = Number(item?.year || 0);
  const episodes = Number(item?.episodes || 0);
  const webp = item?.images?.webp || {};
  const jpg = item?.images?.jpg || {};
  const cover =
    String(webp?.large_image_url || jpg?.large_image_url || webp?.image_url || jpg?.image_url || "").trim();
  const banner = String(
    item?.trailer?.images?.maximum_image_url ||
      item?.trailer?.images?.large_image_url ||
      item?.trailer?.images?.medium_image_url ||
      cover
  ).trim();
  const externalUrl = String(item?.url || (idMal ? `https://myanimelist.net/anime/${idMal}` : "")).trim();

  return {
    id: 0,
    idMal,
    title: {
      english: titleEnglish,
      romaji: titleRomaji,
      native: titleNative
    },
    averageScore: Number.isFinite(score) && score > 0 ? Math.round(score * 10) : 0,
    seasonYear: Number.isFinite(year) && year > 0 ? year : 0,
    episodes: Number.isFinite(episodes) && episodes > 0 ? episodes : 0,
    coverImage: {
      extraLarge: cover,
      large: cover,
      medium: cover
    },
    bannerImage: banner || "",
    externalUrl
  };
}

async function requestJikanSearch(term) {
  if (window.location.protocol === "file:") return [];
  const q = String(term || "").trim();
  if (!q) return [];

  const url = new URL("/api/jikan/anime", window.location.origin);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "10");
  url.searchParams.set("sfw", "true");
  url.searchParams.set("order_by", "members");
  url.searchParams.set("sort", "desc");

  const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Jikan ${r.status}`);
  const json = await r.json().catch(() => ({}));
  const rows = Array.isArray(json?.data) ? json.data.map(mapJikanSearchItem) : [];
  return rows.filter((row) => pickTitle(row.title) !== "Anime");
}

async function runSearch() {
  const term = el.searchInput.value.trim();
  const normalizedTerm = normalizeSearchText(term);
  if (term.length < 2) {
    state.searchRows = [];
    lastResolvedSearchTerm = "";
    searchRequestId += 1;
    clearSearchResults();
    restoreDefaultHeroFromHome();
    return;
  }

  const reqId = ++searchRequestId;
  const localRows = fallbackSearchFromLoadedData(term).slice(0, 8);
  const hasLocalRows = renderSearchRows(localRows, term, reqId);

  if (term.length < SEARCH_REMOTE_MIN_CHARS) {
    if (!hasLocalRows) renderSearchMessage("Sigue escribiendo para buscar.");
    return;
  }

  const cachedRows = getCachedSearchRows(normalizedTerm);
  if (cachedRows?.length) {
    renderSearchRows(cachedRows, term, reqId);
    return;
  }

  if (!hasLocalRows) {
    renderSearchMessage("Buscando...");
  }

  try {
    const data = await requestAniList(searchQuery, { search: term });
    if (reqId !== searchRequestId) return;
    let rows = (data.Page?.media || []).slice(0, 8);
    try {
      rows = await enhanceSearchRowsImageQuality(rows);
    } catch (error) {
      console.warn("Search image enhancement failed", error);
    }
    if (reqId !== searchRequestId) return;
    rows = rows.slice(0, 8);
    if (!rows.length) {
      if (!hasLocalRows) renderSearchMessage("Sin resultados.");
      return;
    }
    setCachedSearchRows(normalizedTerm, rows);
    renderSearchRows(rows, term, reqId);
  } catch (error) {
    if (hasLocalRows) return;
    if (reqId !== searchRequestId) return;
    let fallbackRows = fallbackSearchFromLoadedData(term);
    if (!fallbackRows.length) {
      try {
        fallbackRows = await requestJikanSearch(term);
      } catch {}
    }
    if (fallbackRows.length) {
      renderSearchRows(fallbackRows, term, reqId);
      return;
    }
    if (Number(error?.status || 0) === 429) {
      renderSearchMessage("AniList esta ocupado. Reintenta en unos segundos.");
      return;
    }
    renderSearchMessage("No se pudo buscar ahora.");
  }
}

function animateCardSaveButton(button) {
  if (!button) return;
  button.classList.remove("is-pop");
  // Forzar reflow para reiniciar la animacion.
  void button.offsetWidth;
  button.classList.add("is-pop");
  setTimeout(() => button.classList.remove("is-pop"), 320);
}

function syncCardSaveButtonState(listName, animeId, isActive) {
  const selector = `[data-card-save="${listName}"][data-anime-id="${animeId}"]`;
  const onLabel = listName === "pending" ? "Quitar de ver mas tarde" : "Quitar de favoritos";
  const offLabel = listName === "pending" ? "Guardar para ver mas tarde" : "Guardar en favoritos";
  document.querySelectorAll(selector).forEach((btn) => {
    btn.classList.toggle("active", Boolean(isActive));
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    btn.setAttribute("aria-label", isActive ? onLabel : offLabel);
    btn.setAttribute("title", isActive ? onLabel : offLabel);
  });
}

async function toggleCardList(listName, animeId, triggerButton = null) {
  const labels = {
    pending: "Ver mas tarde",
    favorites: "Favoritos"
  };
  if (!window.YVAuth?.requireAuth?.(`Inicia sesion para guardar animes en ${labels[listName] || "tu lista"}.`)) return;
  const anime = findLoadedAnimeById(animeId);
  if (!anime) return;
  const payload = buildProfileAnimePayload(anime);
  if (!payload) return;

  animateCardSaveButton(triggerButton);

  try {
    const json = await requestJson("/api/profile/list/toggle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        list: listName,
        anime: payload
      })
    });
    const active = Boolean(json?.added);
    if (json?.profile) {
      state.profile = json.profile;
    }
    syncCardSaveButtonState(listName, animeId, active);
  } catch (error) {
    console.warn(`No se pudo actualizar ${listName}`, error);
  }
}

function bindEvents() {
  const applyGlobalFilterFromInputs = async () => {
    state.globalFilter = {
      genre: el.globalGenre.value,
      status: el.globalStatus.value,
      score: el.globalScore.value.trim()
    };

    if (!hasGlobalFilterActive()) {
      state.trending = state.rawTrending.slice();
      state.season = state.rawSeason.slice();
      state.top = state.rawTop.slice();
      renderAllSections();
      enhanceCurrentListsImageQuality();
      return;
    }

    setSkeleton(el.trendingGrid, 8);
    setSkeleton(el.seasonGrid, 6);
    setSkeleton(el.topGrid, 6);

    try {
      const data = await fetchFilteredData();
      if (!data) return;
      state.trending = data.trending?.media || [];
      state.season = data.season?.media || [];
      state.top = data.top?.media || [];
      renderAllSections();
      enhanceCurrentListsImageQuality();
    } catch {
      el.trendingGrid.innerHTML = "<p>No se pudieron cargar resultados para ese filtro.</p>";
      el.seasonGrid.innerHTML = "<p>No se pudieron cargar resultados para ese filtro.</p>";
      el.topGrid.innerHTML = "<p>No se pudieron cargar resultados para ese filtro.</p>";
    }
  };

  el.menuBtn.addEventListener("click", () => el.nav.classList.toggle("show"));
  el.nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => el.nav.classList.remove("show")));
  if (el.headerSearchBtn) {
    el.headerSearchBtn.addEventListener("click", () => {
      const section = document.getElementById("inicio");
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => {
        el.searchInput.focus();
        el.searchInput.select();
      }, 180);
    });
  }
  el.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
  });
  el.searchInput.addEventListener("focus", () => {
    if (el.searchResults.innerHTML.trim()) openSearchResults();
  });
  el.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
    if (e.key === "Escape") clearSearchResults();
  });
  el.searchBtn.addEventListener("click", runSearch);
  el.searchResults.addEventListener("mouseover", (e) => {
    const item = e.target.closest(".search-item");
    if (!item || !el.searchResults.contains(item)) return;
    const hoveredId = Number(item.dataset.id || 0);
    if (!hoveredId || hoveredId === activeSearchHoverId) return;
    activeSearchHoverId = hoveredId;
    void previewSearchHoverHero(hoveredId);
  });
  el.searchResults.addEventListener("mouseleave", () => {
    restoreHeroFromActiveSearch();
  });

  el.quickFilters.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    state.trendingFilter = btn.dataset.filter;
    el.quickFilters.querySelectorAll(".filter-btn").forEach((node) => node.classList.remove("active"));
    btn.classList.add("active");
    renderTrending();
  });

  el.globalApply.addEventListener("click", () => {
    applyGlobalFilterFromInputs();
  });

  el.globalClear.addEventListener("click", () => {
    state.globalFilter = { genre: "", status: "", score: "" };
    state.filterRequestId += 1;
    el.globalGenre.value = "";
    el.globalStatus.value = "";
    el.globalScore.value = "";
    state.trending = state.rawTrending.slice();
    state.season = state.rawSeason.slice();
    state.top = state.rawTop.slice();
    renderAllSections();
    enhanceCurrentListsImageQuality();
  });

  el.continueClear.addEventListener("click", async () => {
    if (isAuthenticated()) {
      try {
        await requestJson("/api/profile/history/clear", { method: "POST" });
        await loadRemoteProfile();
      } catch {}
      renderPersonalizedSections();
      return;
    }
    localStorage.removeItem(CONTINUE_KEY);
    renderPersonalizedSections();
  });

  el.globalGenre.addEventListener("change", applyGlobalFilterFromInputs);
  el.globalStatus.addEventListener("change", applyGlobalFilterFromInputs);
  el.globalScore.addEventListener("input", () => {
    clearTimeout(globalFilterTimer);
    globalFilterTimer = setTimeout(applyGlobalFilterFromInputs, 220);
  });
  el.globalScore.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyGlobalFilterFromInputs();
  });

  document.addEventListener("click", (e) => {
    const insideSearch = el.searchShell?.contains(e.target);
    if (!insideSearch) {
      clearSearchResults();
    }

    const saveBtn = e.target.closest("[data-card-save]");
    if (saveBtn) {
      e.preventDefault();
      e.stopPropagation();
      const listName = String(saveBtn.dataset.cardSave || "").trim();
      const animeId = Number(saveBtn.dataset.animeId || 0);
      if ((listName === "pending" || listName === "favorites") && animeId) {
        void toggleCardList(listName, animeId, saveBtn);
      }
      return;
    }

    const clickable = e.target.closest("[data-id], [data-external]");
    if (!clickable) return;
    if (
      e.target.closest(".card") ||
      e.target.closest(".rank") ||
      e.target.closest(".search-item") ||
      e.target.closest(".continue-card")
    ) {
      if (e.target.closest(".search-item")) clearSearchResults();
      const external = String(clickable.dataset.external || "").trim();
      if (external) {
        window.open(external, "_blank", "noopener");
        return;
      }
      openAnimeTab(clickable.dataset.id, clickable.dataset.ep);
    }
  });

  window.addEventListener("focus", async () => {
    if (window.YVAuth?.refreshSession) {
      state.session = await window.YVAuth.refreshSession();
      await loadRemoteProfile();
    }
    renderPersonalizedSections();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === CONTINUE_KEY) renderPersonalizedSections();
  });
}

async function loadHome() {
  setSkeleton(el.trendingGrid, 8);
  setSkeleton(el.seasonGrid, 6);
  setSkeleton(el.topGrid, 6);

  try {
    const data = await requestAniList(homeQuery, nowSeason());
    const trending = data.trending?.media || [];
    const season = data.season?.media || [];
    const top = data.top?.media || [];
    const genres = data.genres || [];

    state.rawTrending = trending.slice();
    state.rawSeason = season.slice();
    state.rawTop = top.slice();
    state.trending = trending.slice();
    state.season = season.slice();
    state.top = top.slice();
    state.genres = genres;
    hydrateGlobalGenres();
    renderAllSections();
    renderGenreCloud(genres);
    renderStats(trending);
    setupBackgroundCycle(trending);
    enhanceCurrentListsImageQuality();
  } catch {
    el.trendingGrid.innerHTML = "<p>No se pudieron cargar tendencias.</p>";
    el.seasonGrid.innerHTML = "<p>No se pudo cargar la temporada.</p>";
    el.topGrid.innerHTML = "<p>No se pudo cargar el top.</p>";
    el.genreCloud.innerHTML = "<p>Generos no disponibles.</p>";
    renderPersonalizedSections();
  }
}

async function main() {
  if (window.YVAuth?.init) {
    await window.YVAuth.init();
    state.session = window.YVAuth.getSession();
    await loadRemoteProfile();
    window.YVAuth.onChange(async (session) => {
      state.session = session;
      await loadRemoteProfile();
      renderAllSections();
    });
  }
  bindEvents();
  renderPersonalizedSections();
  await loadHome();
}

main();
