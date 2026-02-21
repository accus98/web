const el = {
  profileName: document.getElementById("profileName"),
  profileEmail: document.getElementById("profileEmail"),
  profileStats: document.getElementById("profileStats"),
  profileGate: document.getElementById("profileGate"),
  profileGateBtn: document.getElementById("profileGateBtn"),
  profileLogoutBtn: document.getElementById("profileLogoutBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  historyGrid: document.getElementById("profileHistoryGrid"),
  favoritesGrid: document.getElementById("profileFavoritesGrid"),
  pendingGrid: document.getElementById("profilePendingGrid"),
  recommendedGrid: document.getElementById("profileRecommendedGrid")
};

const state = {
  session: { authenticated: false },
  profile: {
    history: [],
    favorites: [],
    pending: [],
    stats: { history: 0, favorites: 0, pending: 0 }
  },
  recommendations: []
};

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cssUrl(url) {
  return String(url || "").replace(/'/g, "%27");
}

function pickTitle(item) {
  return String(item?.title || "Anime").trim() || "Anime";
}

async function request(url, options = {}) {
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

function isAuthenticated() {
  return Boolean(state.session?.authenticated);
}

function emptyTemplate(message) {
  return `<p class="empty-note">${esc(message)}</p>`;
}

function historyCardTemplate(item) {
  const total = Number(item?.totalEpisodes || item?.episodes || 0);
  const episode = Math.max(1, Number(item?.episodeNumber || 1));
  const progress = total > 0
    ? Math.max(4, Math.min(100, Math.round((episode / total) * 100)))
    : Math.max(6, Math.min(100, episode * 7));
  const bg = item?.banner || item?.cover || "";

  return `
    <article class="continue-card" data-open-id="${item.animeId}" data-open-ep="${episode}" style="--continue-bg:url('${cssUrl(bg)}')">
      <div class="continue-body">
        <div class="continue-top">
          <span class="continue-badge">Seguir</span>
          <button class="mini-action mini-action-danger" type="button" data-history-remove-id="${item.animeId}">Quitar</button>
        </div>
        <h3 class="continue-title">${esc(pickTitle(item))}</h3>
        <p class="continue-episode">Episodio ${episode}${item.episodeTitle ? ` - ${esc(item.episodeTitle)}` : ""}</p>
        <div class="continue-progress">
          <small>${total > 0 ? `${episode}/${total} episodios` : `${episode} episodios vistos`}</small>
          <div class="continue-progress-track">
            <span class="continue-progress-fill" style="width:${progress}%"></span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function listCardTemplate(item, listName) {
  const title = esc(pickTitle(item));
  const cover = esc(item.cover || item.banner || "");
  const score = Number(item.score || 0);
  const status = esc(item.status || "-");

  return `
    <article class="card" data-open-id="${item.animeId}">
      <img src="${cover}" alt="${title}" loading="lazy" />
      <div class="card-body">
        <h3>${title}</h3>
        <div class="meta">
          <span>${score ? `Score ${score}` : "Sin score"}</span>
          <span>${status}</span>
          <span>${item.episodes ? `${item.episodes} eps` : "Eps ?"}</span>
        </div>
      </div>
      <div class="profile-card-actions">
        <button class="btn btn-ghost" type="button" data-toggle-list="${listName}" data-anime-id="${item.animeId}">Quitar</button>
      </div>
    </article>
  `;
}

function recommendedCardTemplate(item) {
  const title = esc(pickTitle(item));
  const cover = esc(item.cover || item.banner || "");
  return `
    <article class="card" data-open-id="${item.animeId}">
      <img src="${cover}" alt="${title}" loading="lazy" />
      <div class="card-body">
        <h3>${title}</h3>
        <div class="meta">
          <span>${item.score ? `Score ${item.score}` : "Sin score"}</span>
          <span>${esc(item.status || "-")}</span>
        </div>
      </div>
      <div class="profile-card-actions">
        <button class="btn btn-ghost" type="button" data-add-list="favorites" data-anime-id="${item.animeId}">Favorito</button>
        <button class="btn btn-ghost" type="button" data-add-list="pending" data-anime-id="${item.animeId}">Pendiente</button>
      </div>
    </article>
  `;
}

function renderStats() {
  const stats = state.profile?.stats || { history: 0, favorites: 0, pending: 0 };
  el.profileStats.innerHTML = `
    <div class="profile-stat"><b>${stats.history || 0}</b><span>Vistos</span></div>
    <div class="profile-stat"><b>${stats.favorites || 0}</b><span>Favoritos</span></div>
    <div class="profile-stat"><b>${stats.pending || 0}</b><span>Pendientes</span></div>
  `;
}

function renderHeader() {
  if (isAuthenticated()) {
    el.profileName.textContent = state.session?.user?.name || "Usuario";
    el.profileEmail.textContent = state.session?.user?.email || "";
    if (el.profileLogoutBtn) el.profileLogoutBtn.hidden = false;
  } else {
    el.profileName.textContent = "Invitado";
    el.profileEmail.textContent = "Inicia sesion para desbloquear tus listas.";
    if (el.profileLogoutBtn) el.profileLogoutBtn.hidden = true;
  }
  renderStats();
}

function renderGate() {
  const open = !isAuthenticated();
  el.profileGate.hidden = !open;
}

function renderHistory() {
  if (!isAuthenticated()) {
    el.historyGrid.innerHTML = emptyTemplate("Inicia sesion para ver tu historial.");
    return;
  }

  const list = state.profile?.history || [];
  if (!list.length) {
    el.historyGrid.innerHTML = emptyTemplate("Aun no hay episodios vistos en tu cuenta.");
    return;
  }

  el.historyGrid.innerHTML = list.map(historyCardTemplate).join("");
}

function renderFavorites() {
  if (!isAuthenticated()) {
    el.favoritesGrid.innerHTML = emptyTemplate("Inicia sesion para gestionar favoritos.");
    return;
  }

  const list = state.profile?.favorites || [];
  if (!list.length) {
    el.favoritesGrid.innerHTML = emptyTemplate("No tienes favoritos todavia.");
    return;
  }

  el.favoritesGrid.innerHTML = list.map((item) => listCardTemplate(item, "favorites")).join("");
}

function renderPending() {
  if (!isAuthenticated()) {
    el.pendingGrid.innerHTML = emptyTemplate("Inicia sesion para gestionar pendientes.");
    return;
  }

  const list = state.profile?.pending || [];
  if (!list.length) {
    el.pendingGrid.innerHTML = emptyTemplate("No tienes pendientes todavia.");
    return;
  }

  el.pendingGrid.innerHTML = list.map((item) => listCardTemplate(item, "pending")).join("");
}

function renderRecommended() {
  if (!isAuthenticated()) {
    el.recommendedGrid.innerHTML = emptyTemplate("Inicia sesion para ver recomendaciones personalizadas.");
    return;
  }

  if (!state.recommendations.length) {
    el.recommendedGrid.innerHTML = emptyTemplate("Sin recomendaciones por ahora. Mira algunos animes y vuelve.");
    return;
  }

  el.recommendedGrid.innerHTML = state.recommendations.map(recommendedCardTemplate).join("");
}

function renderAll() {
  renderHeader();
  renderGate();
  renderHistory();
  renderFavorites();
  renderPending();
  renderRecommended();
}

async function loadProfile() {
  if (!isAuthenticated()) {
    state.profile = {
      history: [],
      favorites: [],
      pending: [],
      stats: { history: 0, favorites: 0, pending: 0 }
    };
    return;
  }

  const json = await request("/api/profile/me");
  state.profile = json?.profile || {
    history: [],
    favorites: [],
    pending: [],
    stats: { history: 0, favorites: 0, pending: 0 }
  };
}

async function loadRecommendations() {
  if (!isAuthenticated()) {
    state.recommendations = [];
    return;
  }

  const json = await request("/api/profile/recommendations");
  state.recommendations = Array.isArray(json?.items) ? json.items : [];
}

function openAnime(animeId, episode = 0) {
  const params = new URLSearchParams();
  params.set("id", String(animeId));
  if (episode > 0) params.set("ep", String(episode));
  window.open(`anime.html?${params.toString()}`, "_blank", "noopener");
}

function findEntryByAnimeId(animeId) {
  const id = Number(animeId || 0);
  if (!id) return null;
  const pools = [state.profile.history || [], state.profile.favorites || [], state.profile.pending || [], state.recommendations || []];
  for (const list of pools) {
    const found = list.find((item) => Number(item?.animeId || 0) === id);
    if (found) return found;
  }
  return null;
}

async function toggleList(listName, animeId) {
  const entry = findEntryByAnimeId(animeId);
  if (!entry) return;

  await request("/api/profile/list/toggle", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      list: listName,
      anime: {
        animeId: entry.animeId,
        idMal: entry.idMal || 0,
        title: pickTitle(entry),
        cover: entry.cover || "",
        banner: entry.banner || "",
        score: entry.score || 0,
        status: entry.status || "",
        episodes: entry.episodes || 0,
        seasonYear: entry.seasonYear || 0,
        genres: Array.isArray(entry.genres) ? entry.genres : []
      }
    })
  });

  await refresh();
}

async function removeHistory(animeId) {
  await request("/api/profile/history/remove", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ animeId: Number(animeId || 0) })
  });
  await refresh();
}

async function clearHistory() {
  await request("/api/profile/history/clear", {
    method: "POST"
  });
  await refresh();
}

async function refresh() {
  try {
    await Promise.all([loadProfile(), loadRecommendations()]);
  } catch {}
  renderAll();
}

function bindEvents() {
  el.profileGateBtn.addEventListener("click", () => {
    window.YVAuth.openAuthModal();
  });

  el.clearHistoryBtn.addEventListener("click", async () => {
    if (!window.YVAuth.requireAuth("Necesitas iniciar sesion para limpiar historial.")) return;
    await clearHistory();
  });

  if (el.profileLogoutBtn) {
    el.profileLogoutBtn.addEventListener("click", async () => {
      await window.YVAuth.logout();
    });
  }

  document.addEventListener("click", async (event) => {
    const removeHistoryBtn = event.target.closest("[data-history-remove-id]");
    if (removeHistoryBtn) {
      event.preventDefault();
      event.stopPropagation();
      if (!window.YVAuth.requireAuth("Necesitas iniciar sesion para modificar el historial.")) return;
      await removeHistory(removeHistoryBtn.dataset.historyRemoveId);
      return;
    }

    const toggleBtn = event.target.closest("[data-toggle-list]");
    if (toggleBtn) {
      event.preventDefault();
      event.stopPropagation();
      if (!window.YVAuth.requireAuth("Necesitas iniciar sesion para modificar tus listas.")) return;
      await toggleList(toggleBtn.dataset.toggleList, toggleBtn.dataset.animeId);
      return;
    }

    const addBtn = event.target.closest("[data-add-list]");
    if (addBtn) {
      event.preventDefault();
      event.stopPropagation();
      if (!window.YVAuth.requireAuth("Necesitas iniciar sesion para guardar animes.")) return;
      await toggleList(addBtn.dataset.addList, addBtn.dataset.animeId);
      return;
    }

    const open = event.target.closest("[data-open-id]");
    if (open) {
      const animeId = Number(open.dataset.openId || 0);
      const ep = Number(open.dataset.openEp || 0);
      if (animeId) {
        openAnime(animeId, ep);
      }
    }
  });
}

async function main() {
  await window.YVAuth.init();
  state.session = window.YVAuth.getSession();

  bindEvents();

  window.YVAuth.onChange(async (session) => {
    state.session = session;
    await refresh();
  });

  await refresh();
}

main();
