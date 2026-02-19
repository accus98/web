const DIRECT_ANILIST_URL = "https://graphql.anilist.co";
const PROXY_ANILIST_URL = "/api/anilist";
const DIRECT_JIKAN_URL = "https://api.jikan.moe/v4";
const PROXY_JIKAN_URL = "/api/jikan";
const PROXY_SYNOPSIS_URL = "/api/synopsis";
const PROXY_IMAGE_QUALITY_URL = "/api/image-quality";

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
  commentList: document.getElementById("commentList")
};

const state = {
  anime: null,
  synopsisEs: "",
  episodes: [],
  currentEpisodeIndex: 0,
  currentServer: SERVERS[0],
  comments: []
};

const bannerMetaCache = new Map();
let headerBackdropToken = 0;

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

function buildEpisodes(anime) {
  const streams = anime.streamingEpisodes || [];
  if (streams.length) {
    return streams
      .map((ep, idx) => ({
        number: parseEpisodeNumber(ep.title, idx + 1),
        title: ep.title || `Episodio ${idx + 1}`,
        thumbnail: ep.thumbnail || bestCover(anime.coverImage),
        url: ep.url || "",
        site: ep.site || ""
      }))
      .sort((a, b) => a.number - b.number);
  }

  const total = Number(anime.episodes || 12);
  return Array.from({ length: total }).map((_, i) => ({
    number: i + 1,
    title: `Episodio ${i + 1}`,
    thumbnail: bestCover(anime.coverImage),
    url: "",
    site: ""
  }));
}

function commentKey() {
  return state.anime ? `yv_comments_${state.anime.id}` : "yv_comments_unknown";
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
  el.serverTabs.innerHTML = SERVERS.map((name) => {
    const active = name === state.currentServer ? "active" : "";
    return `<button class="server-btn ${active}" type="button" data-server="${esc(name)}">${esc(name)}</button>`;
  }).join("");
}

function renderPlayer() {
  const anime = state.anime;
  const trailer = anime.trailer;
  const currentEpisode = state.episodes[state.currentEpisodeIndex];
  const title = pickTitle(anime.title);
  const epNumber = currentEpisode?.number || 1;
  el.playerTitle.textContent = `Episodio ${epNumber} - ${title}`;

  if (currentEpisode?.url) {
    const thumb = String(currentEpisode.thumbnail || bestCover(anime.coverImage)).replace(/'/g, "%27");
    el.playerArea.innerHTML = `
      <div class="player-fallback" style="background-image:url('${thumb}')">
        <div>
          <h4>${esc(currentEpisode.title)}</h4>
          <p>Fuente: ${esc(currentEpisode.site || state.currentServer)}</p>
          <p><a class="btn btn-primary" target="_blank" rel="noopener noreferrer" href="${esc(currentEpisode.url)}">Abrir episodio</a></p>
        </div>
      </div>
    `;
    el.playerNote.textContent = `Servidor ${state.currentServer} - Episodio ${epNumber}`;
    return;
  }

  const trailerId = String(trailer?.id || "").trim();
  if (String(trailer?.site || "").toLowerCase() === "youtube" && trailerId) {
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailerId)}?rel=0&modestbranding=1`;
    el.playerArea.innerHTML = `<iframe src="${src}" title="Trailer ${esc(title)}" allowfullscreen loading="lazy"></iframe>`;
    el.playerNote.textContent = `Servidor ${state.currentServer} - Mostrando trailer oficial (no stream pirata)`;
  } else {
    const poster = bestCover(anime.coverImage);
    el.playerArea.innerHTML = `
      <div class="player-fallback" style="background-image:url('${poster.replace(/'/g, "%27")}')">
        <div>
          <h4>${esc(title)}</h4>
          <p>No hay trailer embebible disponible para este anime.</p>
        </div>
      </div>
    `;
    el.playerNote.textContent = `Servidor ${state.currentServer} seleccionado`;
  }
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
    renderEpisodes();
    renderPlayer();
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
}

async function main() {
  const id = Number(new URLSearchParams(window.location.search).get("id") || 0);
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
    state.episodes = buildEpisodes(state.anime);
    state.currentEpisodeIndex = 0;
    renderHeader();
    state.synopsisEs = await buildSpanishSynopsis(anime);
    renderHeader();
    renderServerTabs();
    renderPlayer();
    renderEpisodes();
    loadComments();
    renderComments();
    bindEvents();
  } catch (error) {
    el.animeTitle.textContent = "Error de carga";
    el.animeDescription.textContent = `No se pudo cargar el anime. ${error.message || ""}`;
  }
}

main();
