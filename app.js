const API_URL = "https://graphql.anilist.co";
const JIKAN_API_URL = "https://api.jikan.moe/v4";

const el = {
  nav: document.getElementById("nav"),
  menuBtn: document.getElementById("menuBtn"),
  hero: document.querySelector(".hero"),
  bg1: document.querySelector(".bg-1"),
  bg2: document.querySelector(".bg-2"),
  stats: document.getElementById("stats"),
  trendingGrid: document.getElementById("trendingGrid"),
  quickFilters: document.getElementById("quickFilters"),
  globalSource: document.getElementById("globalSource"),
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
  rawMalTrending: [],
  rawMalSeason: [],
  rawMalTop: [],
  trending: [],
  season: [],
  top: [],
  genres: [],
  globalFilter: { source: "ANILIST", genre: "", status: "", score: "" },
  trendingFilter: "all",
  filterRequestId: 0
};

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

const SOURCE_MAP = {
  ANILIST: "AniList",
  MYANIMELIST: "MyAnimeList"
};

const MAL_GENRE_IDS = {
  Action: 1,
  Adventure: 2,
  Comedy: 4,
  Drama: 8,
  Ecchi: 9,
  Fantasy: 10,
  Hentai: 12,
  Horror: 14,
  Mecha: 18,
  Music: 19,
  Mystery: 7,
  Psychological: 40,
  Romance: 22,
  "Sci-Fi": 24,
  "Slice of Life": 36,
  Sports: 30,
  Supernatural: 37,
  Thriller: 41
};

const ANILIST_TO_MAL_STATUS = {
  RELEASING: "airing",
  FINISHED: "complete",
  NOT_YET_RELEASED: "upcoming"
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
  const r = await fetch(API_URL, {
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
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJikan(endpoint, params = {}, retries = 2) {
  const url = new URL(`${JIKAN_API_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === "" || value === null || value === undefined) return;
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json"
    }
  });

  if (response.status === 429 && retries > 0) {
    await sleep(850);
    return requestJikan(endpoint, params, retries - 1);
  }
  if (!response.ok) throw new Error(`Jikan ${response.status}`);
  const json = await response.json();
  return json?.data || [];
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

function pickTitle(title) {
  return title?.english || title?.romaji || title?.native || "Anime";
}

function bestCover(coverImage) {
  return coverImage?.extraLarge || coverImage?.large || coverImage?.medium || "";
}

function coverSrcSet(coverImage) {
  const parts = [];
  if (coverImage?.medium) parts.push(`${esc(coverImage.medium)} 240w`);
  if (coverImage?.large) parts.push(`${esc(coverImage.large)} 460w`);
  if (coverImage?.extraLarge) parts.push(`${esc(coverImage.extraLarge)} 680w`);
  return parts.join(", ");
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

function sourceLabel(value) {
  return SOURCE_MAP[value] || "AniList";
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function malStatusFromAniList(value) {
  return ANILIST_TO_MAL_STATUS[value] || "";
}

function aniStatusFromMal(value) {
  const status = String(value || "").toLowerCase();
  if (status.includes("airing")) return "RELEASING";
  if (status.includes("finished")) return "FINISHED";
  if (status.includes("not yet")) return "NOT_YET_RELEASED";
  return "";
}

function aniSeasonFromMal(value) {
  const season = String(value || "").toLowerCase();
  if (season === "winter") return "WINTER";
  if (season === "spring") return "SPRING";
  if (season === "summer") return "SUMMER";
  if (season === "fall") return "FALL";
  return "";
}

function normalizeMyAnimeListMedia(item) {
  const cover =
    item?.images?.webp?.large_image_url ||
    item?.images?.jpg?.large_image_url ||
    item?.images?.webp?.image_url ||
    item?.images?.jpg?.image_url ||
    "";
  const banner =
    item?.trailer?.images?.maximum_image_url ||
    item?.trailer?.images?.large_image_url ||
    item?.images?.jpg?.large_image_url ||
    cover;
  const score10 = Number(item?.score);
  const score100 = Number.isFinite(score10) ? Math.round(score10 * 10) : null;
  const year = item?.year || item?.aired?.prop?.from?.year || null;

  return {
    id: null,
    idMal: item?.mal_id || null,
    source: "MYANIMELIST",
    title: {
      english: item?.title_english || "",
      romaji: item?.title || "",
      native: item?.title_japanese || ""
    },
    episodes: item?.episodes || null,
    averageScore: score100,
    season: aniSeasonFromMal(item?.season),
    seasonYear: year,
    status: aniStatusFromMal(item?.status),
    genres: (item?.genres || []).map((g) => g?.name).filter(Boolean),
    coverImage: {
      extraLarge: cover,
      large: cover,
      medium: cover
    },
    bannerImage: banner
  };
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
  return Boolean(f.source !== "ANILIST" || f.genre || f.status || f.score);
}

async function fetchAniListFilteredData() {
  const reqId = ++state.filterRequestId;
  const seasonInfo = nowSeason();
  const escapeGraphQLString = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const args = [];
  if (state.globalFilter.genre) args.push(`genre: "${escapeGraphQLString(state.globalFilter.genre)}"`);
  if (state.globalFilter.status) args.push(`status: ${state.globalFilter.status}`);
  if (state.globalFilter.score) args.push(`averageScore_greater: ${toNumber(state.globalFilter.score)}`);
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
  return {
    trending: data.trending?.media || [],
    season: data.season?.media || [],
    top: data.top?.media || []
  };
}

async function fetchMyAnimeListFilteredData() {
  const reqId = ++state.filterRequestId;
  const scoreMin = toNumber(state.globalFilter.score);
  const malStatus = malStatusFromAniList(state.globalFilter.status);
  const genreId = MAL_GENRE_IDS[state.globalFilter.genre] || "";
  const commonParams = {
    sfw: true,
    limit: 24,
    page: 1
  };

  if (genreId) commonParams.genres = genreId;
  if (malStatus) commonParams.status = malStatus;
  if (scoreMin > 0) commonParams.min_score = Math.min(10, Math.max(0, scoreMin / 10)).toFixed(1);

  const trendingParams = {
    ...commonParams,
    order_by: "members",
    sort: "desc"
  };
  const seasonParams = {
    ...commonParams,
    order_by: "popularity",
    sort: "asc",
    status: malStatus || "airing"
  };
  const topParams = {
    ...commonParams,
    order_by: "score",
    sort: "desc"
  };

  const [trendingRaw, seasonRaw, topRaw] = await Promise.all([
    requestJikan("/anime", trendingParams),
    requestJikan("/anime", seasonParams),
    requestJikan("/anime", topParams)
  ]);

  if (reqId !== state.filterRequestId) return null;

  const trending = trendingRaw.map(normalizeMyAnimeListMedia);
  const season = seasonRaw.map(normalizeMyAnimeListMedia);
  const top = topRaw.map(normalizeMyAnimeListMedia);
  return { trending, season, top };
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

function mediaDataAttrs(anime) {
  const source = anime.source || "ANILIST";
  const anilistId = anime.id ? String(anime.id) : "";
  const malId = anime.idMal ? String(anime.idMal) : "";
  return `data-source="${esc(source)}" data-anilist-id="${esc(anilistId)}" data-mal-id="${esc(malId)}"`;
}

function cardTemplate(anime) {
  const title = esc(pickTitle(anime.title));
  const image = bestCover(anime.coverImage);
  const srcset = coverSrcSet(anime.coverImage);
  return `
  <article class="card reveal" ${mediaDataAttrs(anime)}>
    <img data-src="${esc(image)}" data-srcset="${srcset}" data-sizes="(max-width: 760px) 50vw, (max-width: 1200px) 25vw, 280px" alt="${title}" loading="lazy" />
    <div class="card-body">
      <h3>${title}</h3>
      <div class="meta">
        <span>${anime.averageScore ? `Score ${anime.averageScore}` : "Sin score"}</span>
        <span>${anime.episodes ? `${anime.episodes} eps` : "Por confirmar"}</span>
        <span>${toStatus(anime.status)}</span>
        <span>${sourceLabel(anime.source || "ANILIST")}</span>
      </div>
    </div>
  </article>`;
}

function seasonTemplate(anime) {
  const title = esc(pickTitle(anime.title));
  const image = anime.bannerImage || bestCover(anime.coverImage);
  const srcset = coverSrcSet(anime.coverImage);
  return `
  <article class="card reveal" ${mediaDataAttrs(anime)}>
    <img data-src="${esc(image)}" data-srcset="${srcset}" data-sizes="(max-width: 980px) 100vw, 33vw" alt="${title}" loading="lazy" />
    <div class="card-body">
      <h3>${title}</h3>
      <div class="meta">
        <span>${toSeason(anime.season)} ${anime.seasonYear || ""}</span>
        <span>${anime.averageScore ? `Score ${anime.averageScore}` : "Nuevo"}</span>
        <span>${sourceLabel(anime.source || "ANILIST")}</span>
      </div>
    </div>
  </article>`;
}

function topTemplate(anime, idx) {
  const title = esc(pickTitle(anime.title));
  const image = bestCover(anime.coverImage);
  const srcset = coverSrcSet(anime.coverImage);
  return `
  <article class="rank reveal" ${mediaDataAttrs(anime)}>
    <div class="rank-num">${idx + 1}</div>
    <img data-src="${esc(image)}" data-srcset="${srcset}" data-sizes="66px" alt="${title}" loading="lazy" />
    <div>
      <h3>${title}</h3>
      <div class="meta">
        <span>${anime.averageScore ? `Score ${anime.averageScore}` : "Sin score"}</span>
        <span>${anime.episodes ? `${anime.episodes} eps` : "Por confirmar"}</span>
        <span>${anime.seasonYear || "-"}</span>
        <span>${sourceLabel(anime.source || "ANILIST")}</span>
      </div>
    </div>
  </article>`;
}

function searchItemTemplate(anime) {
  const title = esc(pickTitle(anime.title));
  const image = bestCover(anime.coverImage);
  const srcset = coverSrcSet(anime.coverImage);
  return `
  <article class="search-item" ${mediaDataAttrs(anime)}>
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

function setupBackgroundCycle(animes) {
  const images = animes
    .map((a) => a.bannerImage || bestCover(a.coverImage))
    .filter(Boolean)
    .slice(0, 8);
  if (!images.length) return;

  el.hero.style.backgroundImage = `url('${cssUrl(images[0])}')`;
  el.hero.style.backgroundSize = "cover";
  el.hero.style.backgroundPosition = "center";

  el.bg1.style.backgroundImage = `url('${cssUrl(images[0])}')`;

  let i = 0;
  let second = false;
  setInterval(() => {
    i = (i + 1) % images.length;
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

function openAnimeTab({ source, anilistId, malId }) {
  if (!anilistId && !malId) return;
  const normalizedSource = source === "MYANIMELIST" ? "MYANIMELIST" : "ANILIST";
  let url = "anime.html";
  if (normalizedSource === "MYANIMELIST" && malId) {
    url += `?idMal=${encodeURIComponent(malId)}&source=myanimelist`;
  } else if (anilistId) {
    url += `?id=${encodeURIComponent(anilistId)}`;
  } else if (malId) {
    url += `?idMal=${encodeURIComponent(malId)}&source=myanimelist`;
  }
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
    const rows = data.Page?.media || [];
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
      source: el.globalSource.value || "ANILIST",
      genre: el.globalGenre.value,
      status: el.globalStatus.value,
      score: el.globalScore.value.trim()
    };

    const usingAniList = state.globalFilter.source === "ANILIST";
    const hasOnlySourceFilter = !state.globalFilter.genre && !state.globalFilter.status && !state.globalFilter.score;

    if (usingAniList && hasOnlySourceFilter) {
      state.trending = state.rawTrending.slice();
      state.season = state.rawSeason.slice();
      state.top = state.rawTop.slice();
      renderAllSections();
      renderStats(state.trending);
      return;
    }

    if (!usingAniList && hasOnlySourceFilter && state.rawMalTrending.length) {
      state.trending = state.rawMalTrending.slice();
      state.season = state.rawMalSeason.slice();
      state.top = state.rawMalTop.slice();
      renderAllSections();
      renderStats(state.trending);
      return;
    }

    setSkeleton(el.trendingGrid, 8);
    setSkeleton(el.seasonGrid, 6);
    setSkeleton(el.topGrid, 6);

    try {
      const data = usingAniList
        ? await fetchAniListFilteredData()
        : await fetchMyAnimeListFilteredData();
      if (!data) return;
      state.trending = data.trending || [];
      state.season = data.season || [];
      state.top = data.top || [];
      if (!usingAniList && hasOnlySourceFilter) {
        state.rawMalTrending = state.trending.slice();
        state.rawMalSeason = state.season.slice();
        state.rawMalTop = state.top.slice();
      }
      renderAllSections();
      renderStats(state.trending);
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
    state.globalFilter = { source: "ANILIST", genre: "", status: "", score: "" };
    state.filterRequestId += 1;
    el.globalSource.value = "ANILIST";
    el.globalGenre.value = "";
    el.globalStatus.value = "";
    el.globalScore.value = "";
    state.trending = state.rawTrending.slice();
    state.season = state.rawSeason.slice();
    state.top = state.rawTop.slice();
    renderAllSections();
    renderStats(state.trending);
  });

  el.globalSource.addEventListener("change", applyGlobalFilterFromInputs);
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
    const clickable = e.target.closest("[data-source]");
    if (!clickable) return;
    if (e.target.closest(".card") || e.target.closest(".rank") || e.target.closest(".search-item")) {
      openAnimeTab({
        source: clickable.dataset.source,
        anilistId: clickable.dataset.anilistId,
        malId: clickable.dataset.malId
      });
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
