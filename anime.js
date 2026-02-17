const API_URL = "https://graphql.anilist.co";

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
query Detail($id: Int, $idMal: Int) {
  Media(id: $id, idMal: $idMal, type: ANIME) {
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
  anilistLink: document.getElementById("anilistLink"),
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

function cleanDescription(text) {
  return String(text || "Sin sinopsis disponible.")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksSpanish(text) {
  const sample = String(text || "").toLowerCase();
  if (!sample) return true;
  return /\b(el|la|los|las|de|del|que|una|uno|con|sin|para|por)\b/.test(sample);
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
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|es`;
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
  const r = await fetch(`https://api.jikan.moe/v4/anime/${idMal}/full`, {
    headers: { Accept: "application/json" }
  });
  if (!r.ok) return "";
  const json = await r.json();
  return cleanDescription(json?.data?.synopsis || "");
}

function synopsisCacheKey(anime) {
  const base = cleanDescription(anime?.description || "");
  const hashPart = `${anime?.id || "x"}_${base.length}`;
  return `yv_synopsis_es_${hashPart}`;
}

async function buildSpanishSynopsis(anime) {
  const cacheKey = synopsisCacheKey(anime);
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;
  } catch {}

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
  return fetch(API_URL, {
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
  el.anilistLink.href = anime.siteUrl || "#";
  el.animeHeader.style.backgroundImage = banner ? `linear-gradient(180deg, rgba(6,12,18,0.55), rgba(6,12,18,0.86)), url('${banner.replace(/'/g, "%27")}')` : "";
  el.animeHeader.style.backgroundSize = "cover";
  el.animeHeader.style.backgroundPosition = "center";
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
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get("id") || 0);
  const idMal = Number(params.get("idMal") || 0);

  if (!id && !idMal) {
    el.animeTitle.textContent = "ID invalido";
    el.animeDescription.textContent = "No se recibio un id valido de anime.";
    return;
  }

  try {
    const data = await requestAniList(detailQuery, { id: id || null, idMal: idMal || null });
    const anime = data.Media;
    if (!anime) {
      el.animeTitle.textContent = "No encontrado";
      el.animeDescription.textContent = "No existe informacion para este anime.";
      return;
    }

    state.anime = anime;
    state.synopsisEs = "Cargando sinopsis...";
    state.episodes = buildEpisodes(anime);
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
