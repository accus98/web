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
    trailer { id site thumbnail }
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
  currentEpisode: 1,
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
  el.animeDescription.textContent = cleanDescription(anime.description);
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
  const title = pickTitle(anime.title);
  const ep = state.currentEpisode;
  el.playerTitle.textContent = `Episodio ${ep} - ${title}`;

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
  const raw = Number(state.anime?.episodes || 0);
  if (raw > 0) return raw;
  return 12;
}

function renderEpisodes() {
  const query = el.episodeSearch.value.trim().toLowerCase();
  const total = episodeCount();
  const items = [];
  for (let i = 1; i <= total; i += 1) {
    const label = `episodio ${i}`;
    if (query && !label.includes(query) && !String(i).includes(query)) continue;
    const active = i === state.currentEpisode ? "active" : "";
    items.push(`
      <button type="button" class="episode-item ${active}" data-episode="${i}">
        <strong>Episodio ${i}</strong>
        <span>${pickTitle(state.anime.title)}</span>
      </button>
    `);
  }
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
    const btn = e.target.closest("[data-episode]");
    if (!btn) return;
    state.currentEpisode = Number(btn.dataset.episode);
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

    state.anime = anime;
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
