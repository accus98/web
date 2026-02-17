const API_URL = "https://graphql.anilist.co";

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
  trending: [],
  season: [],
  top: [],
  genres: [],
  globalFilter: { genre: "", status: "", score: "" },
  trendingFilter: "all"
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

const homeQuery = `
query HomePageData($season: MediaSeason, $seasonYear: Int) {
  trending: Page(page: 1, perPage: 12) {
    media(type: ANIME, sort: TRENDING_DESC) {
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
  season: Page(page: 1, perPage: 6) {
    media(type: ANIME, sort: POPULARITY_DESC, season: $season, seasonYear: $seasonYear) {
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
  top: Page(page: 1, perPage: 10) {
    media(type: ANIME, sort: SCORE_DESC) {
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
  genres: GenreCollection
}
`;

const searchQuery = `
query SearchAnime($search: String) {
  Page(page: 1, perPage: 6) {
    media(type: ANIME, sort: POPULARITY_DESC, search: $search) {
      id
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
    : "<p>No hay resultados para este filtro.</p>";
  lazyLoadImages();
  initReveal();
}

function renderSeason() {
  const filtered = state.season.filter(passGlobalFilter);
  el.seasonGrid.innerHTML = filtered.length
    ? filtered.map(seasonTemplate).join("")
    : "<p>No hay resultados para el filtro general.</p>";
}

function renderTop() {
  const filtered = state.top.filter(passGlobalFilter);
  el.topGrid.innerHTML = filtered.length
    ? filtered.map(topTemplate).join("")
    : "<p>No hay resultados para el filtro general.</p>";
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

async function openModal(id) {
  el.modal.classList.add("open");
  el.modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  el.modalBody.innerHTML = "<p>Cargando detalle...</p>";
  el.modalBanner.style.backgroundImage = "none";

  try {
    const data = await requestAniList(detailQuery, { id: Number(id) });
    const anime = data.Media;
    if (!anime) {
      el.modalBody.innerHTML = "<p>No se encontro informacion.</p>";
      return;
    }

    const banner = anime.bannerImage || bestCover(anime.coverImage);
    el.modalBanner.style.backgroundImage = banner ? `url('${cssUrl(banner)}')` : "none";

    const title = esc(pickTitle(anime.title));
    const desc = esc(cleanDescription(anime.description));
    const genres = (anime.genres || []).map((g) => `<span class="genre-pill">${esc(toGenre(g))}</span>`).join("");

    el.modalBody.innerHTML = `
      <h3>${title}</h3>
      <div class="meta">
        <span>${anime.averageScore ? `Score ${anime.averageScore}` : "Sin score"}</span>
        <span>${anime.episodes ? `${anime.episodes} episodios` : "Por confirmar"}</span>
        <span>${anime.duration ? `${anime.duration} min/ep` : "-"}</span>
        <span>${toSeason(anime.season)} ${anime.seasonYear || ""}</span>
        <span>${toStatus(anime.status)}</span>
      </div>
      <p class="modal-desc">${desc}</p>
      <div class="genre-cloud">${genres}</div>
      <p><a class="btn btn-primary" target="_blank" rel="noopener noreferrer" href="${esc(anime.siteUrl || "#")}">Ver en AniList</a></p>
    `;
  } catch (error) {
    el.modalBody.innerHTML = `<p>No se pudo cargar el detalle. ${esc(error.message || "")}</p>`;
  }
}

function closeModal() {
  el.modal.classList.remove("open");
  el.modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
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
  const applyGlobalFilterFromInputs = () => {
    state.globalFilter = {
      genre: el.globalGenre.value,
      status: el.globalStatus.value,
      score: el.globalScore.value.trim()
    };
    renderAllSections();
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
    el.globalGenre.value = "";
    el.globalStatus.value = "";
    el.globalScore.value = "";
    renderAllSections();
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
      openModal(clickable.dataset.id);
    }
  });

  el.modalClose.addEventListener("click", closeModal);
  el.modal.addEventListener("click", (e) => {
    if (e.target === el.modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.modal.classList.contains("open")) closeModal();
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

    state.trending = trending;
    state.season = season;
    state.top = top;
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
