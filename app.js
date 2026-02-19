const DIRECT_ANILIST_URL = "https://graphql.anilist.co";
const PROXY_ANILIST_URL = "/api/anilist";
const PROXY_IMAGE_QUALITY_URL = "/api/image-quality";

const el = {
  nav: document.getElementById("nav"),
  menuBtn: document.getElementById("menuBtn"),
  hero: document.querySelector(".hero"),
  bg1: document.querySelector(".bg-1"),
  bg2: document.querySelector(".bg-2"),
  stats: document.getElementById("stats"),
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
  globalFilter: { genre: "", status: "", score: "" },
  trendingFilter: "all",
  filterRequestId: 0,
  imageEnhanceRequestId: 0
};

const imageQualityCache = new Map();
const imageMetaCache = new Map();
let heroCycleTimer = null;
let heroCycleToken = 0;

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
  Page(page: 1, perPage: 6) {
    media(type: ANIME, sort: POPULARITY_DESC, search: $search) {
      id
      idMal
      title { romaji english native }
      averageScore
      seasonYear
      episodes
      coverImage { extraLarge large medium }
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
    if (!r.ok) throw new Error(`AniList ${r.status}`);
    const json = await r.json();
    if (json.errors) throw new Error(json.errors[0]?.message || "GraphQL error");
    return json.data;
  };

  if (window.location.protocol === "file:") {
    return requestAniListFrom(DIRECT_ANILIST_URL);
  }

  try {
    return await requestAniListFrom(PROXY_ANILIST_URL);
  } catch {
    return requestAniListFrom(DIRECT_ANILIST_URL);
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

async function pickHeroImages(animes) {
  const bannerCandidates = uniqueUrls((animes || []).map((a) => a.bannerImage), 16);
  const coverCandidates = uniqueUrls((animes || []).map((a) => bestCover(a.coverImage)), 16);
  const combined = uniqueUrls([...bannerCandidates, ...coverCandidates], 16);
  if (!combined.length) return [];

  const checked = await Promise.all(
    combined.map(async (url) => ({
      url,
      ...(await loadImageMeta(url))
    }))
  );

  const strong = checked
    .filter((item) => item.width >= 1200 && item.height >= 450)
    .map((item) => item.url);
  if (strong.length) return strong.slice(0, 8);

  const acceptable = checked
    .filter((item) => item.width >= 900 && item.height >= 320)
    .map((item) => item.url);
  if (acceptable.length) return acceptable.slice(0, 8);

  return combined.slice(0, 8);
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
  const filtered = filterTrending(state.trending, state.trendingFilter).filter(passGlobalFilter);
  el.trendingGrid.innerHTML = filtered.length
    ? filtered.map(cardTemplate).join("")
    : `<p>${noResultsText("tendencias", state.trending)}</p>`;
  lazyLoadImages();
  initReveal();
}

function renderSeason() {
  const filtered = state.season.filter(passGlobalFilter);
  el.seasonGrid.innerHTML = filtered.length
    ? filtered.map(seasonTemplate).join("")
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

function cardTemplate(anime) {
  const title = esc(pickTitle(anime.title));
  const image = bestCover(anime.coverImage);
  const srcset = coverSrcSet(anime.coverImage);
  return `
  <article class="card reveal" data-id="${anime.id}">
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

function seasonTemplate(anime) {
  const title = esc(pickTitle(anime.title));
  const image = anime.bannerImage || bestCover(anime.coverImage);
  const srcset = coverSrcSet(anime.coverImage);
  return `
  <article class="card reveal" data-id="${anime.id}">
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

function searchItemTemplate(anime) {
  const title = esc(pickTitle(anime.title));
  const image = bestCover(anime.coverImage);
  const srcset = coverSrcSet(anime.coverImage);
  return `
  <article class="search-item" data-id="${anime.id}">
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

function openAnimeTab(id) {
  const url = `anime.html?id=${encodeURIComponent(id)}`;
  window.open(url, "_blank", "noopener");
}

let searchTimer = null;
let globalFilterTimer = null;
async function runSearch() {
  const term = el.searchInput.value.trim();
  if (term.length < 2) {
    el.searchResults.innerHTML = "";
    return;
  }
  el.searchResults.innerHTML = "<p>Buscando...</p>";
  try {
    const data = await requestAniList(searchQuery, { search: term });
    let rows = data.Page?.media || [];
    rows = await enhanceSearchRowsImageQuality(rows);
    el.searchResults.innerHTML = rows.length
      ? rows.map(searchItemTemplate).join("")
      : "<p>Sin resultados.</p>";
    lazyLoadImages();
  } catch {
    el.searchResults.innerHTML = "<p>No se pudo buscar ahora.</p>";
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

  el.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 320);
  });
  el.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
  el.searchBtn.addEventListener("click", runSearch);

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
    const clickable = e.target.closest("[data-id]");
    if (!clickable) return;
    if (e.target.closest(".card") || e.target.closest(".rank") || e.target.closest(".search-item")) {
      openAnimeTab(clickable.dataset.id);
    }
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
  }
}

async function main() {
  bindEvents();
  await loadHome();
}

main();
