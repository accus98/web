(() => {
  const CONFIG_URL = "/api/config";
  const SESSION_URL = "/api/auth/session";
  const GOOGLE_LOGIN_URL = "/api/auth/google";
  const LOCAL_LOGIN_URL = "/api/auth/login";
  const LOCAL_REGISTER_URL = "/api/auth/register";
  const LOGOUT_URL = "/api/auth/logout";

  const state = {
    config: {
      googleAuthEnabled: false,
      googleClientId: "",
      localAuthEnabled: true,
      passwordMinLen: 6
    },
    session: { authenticated: false },
    listeners: [],
    modalReady: false,
    googleScriptPromise: null,
    googleInitialized: false,
    mode: "login"
  };

  const el = {
    authTrigger: null,
    logoutBtn: null,
    profileLink: null,
    profileLogo: null,
    profileAvatar: null,
    authModal: null,
    authClose: null,
    authCloseAction: null,
    authLogoutAction: null,
    authMessage: null,
    authTitle: null,
    authSubtitle: null,
    authMode: null,
    authModeLogin: null,
    authModeRegister: null,
    authForm: null,
    authEmail: null,
    authPassword: null,
    authNameGroup: null,
    authName: null,
    authSubmit: null,
    authGoogleSection: null,
    authGoogleWrap: null,
    authHelper: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function notify() {
    const snapshot = { ...state.session };
    state.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {}
    });
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

  function setMessage(message = "", type = "") {
    if (!el.authMessage) return;
    el.authMessage.textContent = String(message || "");
    el.authMessage.className = "auth-message";
    if (type) el.authMessage.classList.add(type);
  }

  function isAuthenticated() {
    return Boolean(state.session?.authenticated);
  }

  function updateHeaderUI() {
    const authenticated = isAuthenticated();
    const userName = state.session?.user?.name || "";
    const userPicture = String(state.session?.user?.picture || "").trim();

    if (el.authTrigger) {
      el.authTrigger.hidden = true;
      el.authTrigger.style.display = "none";
    }

    if (el.logoutBtn) {
      el.logoutBtn.hidden = true;
      el.logoutBtn.style.display = "none";
    }

    if (el.authLogoutAction) {
      el.authLogoutAction.hidden = !authenticated;
      el.authLogoutAction.style.display = authenticated ? "inline-flex" : "none";
    }

    if (el.profileLogo) {
      if (authenticated && !userPicture) {
        const label = userName
          .split(" ")
          .map((chunk) => chunk.trim()[0] || "")
          .join("")
          .slice(0, 2)
          .toUpperCase();
        el.profileLogo.textContent = label || "YV";
        el.profileLogo.hidden = false;
      } else {
        el.profileLogo.textContent = "YV";
        el.profileLogo.hidden = false;
      }
    }

    if (el.profileAvatar) {
      if (authenticated && userPicture) {
        el.profileAvatar.src = userPicture;
        el.profileAvatar.hidden = false;
        if (el.profileLogo) el.profileLogo.hidden = true;
      } else {
        el.profileAvatar.hidden = true;
        el.profileAvatar.removeAttribute("src");
      }
    }
  }

  function setMode(mode) {
    state.mode = mode === "register" ? "register" : "login";
    const register = state.mode === "register";

    if (el.authModeLogin) el.authModeLogin.classList.toggle("active", !register);
    if (el.authModeRegister) el.authModeRegister.classList.toggle("active", register);
    if (el.authNameGroup) el.authNameGroup.hidden = !register;
    if (el.authSubmit) el.authSubmit.textContent = register ? "Crear cuenta" : "Acceder";
  }

  async function handleLocalSubmit(event) {
    event.preventDefault();
    if (isAuthenticated()) return;

    if (!state.config.localAuthEnabled) {
      setMessage("El acceso por correo no esta habilitado.", "error");
      return;
    }

    const email = String(el.authEmail?.value || "")
      .trim()
      .toLowerCase();
    const password = String(el.authPassword?.value || "");
    const name = String(el.authName?.value || "").trim();

    if (!email) {
      setMessage("Introduce un correo valido.", "error");
      return;
    }
    if (!password) {
      setMessage("Introduce tu contrasena.", "error");
      return;
    }

    if (state.mode === "register" && password.length < Number(state.config.passwordMinLen || 6)) {
      setMessage(`La contrasena debe tener al menos ${state.config.passwordMinLen || 6} caracteres.`, "error");
      return;
    }

    setMessage("Validando cuenta...", "success");
    try {
      const endpoint = state.mode === "register" ? LOCAL_REGISTER_URL : LOCAL_LOGIN_URL;
      const payload = state.mode === "register" ? { email, password, name } : { email, password };
      await request(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      await refreshSession();
      closeAuthModal();
      setMessage("");
      if (el.authPassword) el.authPassword.value = "";
    } catch (error) {
      setMessage(error.message || "No se pudo completar la autenticacion.", "error");
    }
  }

  function ensureModalDom() {
    if (state.modalReady) return;

    let modal = byId("authModal");
    if (!modal) {
      modal = document.createElement("aside");
      modal.id = "authModal";
      modal.className = "modal";
      modal.setAttribute("aria-hidden", "true");
      modal.innerHTML = `
        <div class="modal-dialog auth-dialog">
          <button id="authClose" class="modal-close" aria-label="Cerrar">&times;</button>
          <div class="auth-shell">
            <section class="auth-visual" aria-hidden="true">
              <div class="auth-logo">YV</div>
              <h4>Comunidad Premium</h4>
              <p>Inicia sesion para guardar favoritos, continuar episodios y desbloquear tu perfil personalizado.</p>
              <div class="auth-orbs">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </section>

            <section class="auth-body">
              <h3 id="authModalTitle">Iniciar sesion</h3>
              <p id="authModalSubtitle">Accede con tu cuenta para sincronizar tus listas.</p>

              <div id="authMode" class="auth-mode">
                <button id="authModeLogin" class="auth-mode-btn active" type="button">Iniciar sesion</button>
                <button id="authModeRegister" class="auth-mode-btn" type="button">Crear cuenta</button>
              </div>

              <form id="authForm" class="auth-form">
                <label class="auth-label" for="authEmail">Correo electronico</label>
                <input id="authEmail" class="auth-input" type="email" placeholder="tu@email.com" autocomplete="email" required />

                <label class="auth-label" for="authPassword">Contrasena</label>
                <input id="authPassword" class="auth-input" type="password" placeholder="Minimo 6 caracteres" autocomplete="current-password" required />

                <div id="authNameGroup" hidden>
                  <label class="auth-label" for="authName">Nombre de perfil</label>
                  <input id="authName" class="auth-input" type="text" maxlength="80" placeholder="Como quieres aparecer" autocomplete="name" />
                </div>

                <button id="authSubmit" class="btn btn-primary" type="submit">Acceder</button>
              </form>

              <section id="authGoogleSection" class="auth-google-section">
                <div class="auth-divider"><span>o continuar con Google</span></div>
                <div id="authGoogleWrap" class="auth-google-wrap"></div>
                <p id="authGoogleHelp" class="auth-helper"></p>
              </section>

              <div class="auth-actions auth-actions-stack">
                <button id="authCloseAction" class="btn btn-ghost" type="button">Cerrar</button>
                <button id="authLogoutAction" class="btn btn-danger" type="button" hidden>Cerrar sesion</button>
              </div>
              <p id="authMessage" class="auth-message"></p>
            </section>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    el.authModal = modal;
    el.authClose = byId("authClose");
    el.authCloseAction = byId("authCloseAction");
    el.authLogoutAction = byId("authLogoutAction");
    el.authMessage = byId("authMessage");
    el.authTitle = byId("authModalTitle");
    el.authSubtitle = byId("authModalSubtitle");
    el.authMode = byId("authMode");
    el.authModeLogin = byId("authModeLogin");
    el.authModeRegister = byId("authModeRegister");
    el.authForm = byId("authForm");
    el.authEmail = byId("authEmail");
    el.authPassword = byId("authPassword");
    el.authNameGroup = byId("authNameGroup");
    el.authName = byId("authName");
    el.authSubmit = byId("authSubmit");
    el.authGoogleSection = byId("authGoogleSection");
    el.authGoogleWrap = byId("authGoogleWrap");
    el.authHelper = byId("authGoogleHelp");

    const closeHandler = () => closeAuthModal();
    if (el.authClose) el.authClose.addEventListener("click", closeHandler);
    if (el.authCloseAction) el.authCloseAction.addEventListener("click", closeHandler);
    if (el.authModal) {
      el.authModal.addEventListener("click", (event) => {
        if (event.target === el.authModal) closeAuthModal();
      });
    }

    if (el.authLogoutAction) {
      el.authLogoutAction.addEventListener("click", async () => {
        try {
          await logout();
          closeAuthModal();
        } catch {
          setMessage("No se pudo cerrar sesion.", "error");
        }
      });
    }

    if (el.authModeLogin) {
      el.authModeLogin.addEventListener("click", () => setMode("login"));
    }
    if (el.authModeRegister) {
      el.authModeRegister.addEventListener("click", () => setMode("register"));
    }
    if (el.authForm) {
      el.authForm.addEventListener("submit", handleLocalSubmit);
    }

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAuthModal();
    });

    setMode("login");
    state.modalReady = true;
  }

  function ensureGoogleSdk() {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (state.googleScriptPromise) return state.googleScriptPromise;

    state.googleScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("No se pudo cargar Google Identity Services"));
      document.head.appendChild(script);
    });
    return state.googleScriptPromise;
  }

  async function handleGoogleCredential(response) {
    const credential = String(response?.credential || "").trim();
    if (!credential) {
      setMessage("Google no devolvio credenciales.", "error");
      return;
    }

    setMessage("Validando cuenta de Google...", "success");
    try {
      await request(GOOGLE_LOGIN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ credential })
      });
      await refreshSession();
      closeAuthModal();
      setMessage("");
    } catch (error) {
      setMessage(error.message || "No se pudo iniciar sesion con Google.", "error");
    }
  }

  async function renderGoogleButton() {
    if (!el.authGoogleSection || !el.authGoogleWrap || !el.authHelper) return;

    if (isAuthenticated()) {
      el.authGoogleSection.hidden = true;
      return;
    }

    if (!state.config?.googleAuthEnabled || !state.config?.googleClientId) {
      el.authGoogleSection.hidden = true;
      return;
    }

    el.authGoogleSection.hidden = false;

    try {
      await ensureGoogleSdk();
      if (!window.google?.accounts?.id) throw new Error("Google SDK no disponible");

      if (!state.googleInitialized) {
        window.google.accounts.id.initialize({
          client_id: state.config.googleClientId,
          callback: handleGoogleCredential,
          auto_select: false,
          cancel_on_tap_outside: true
        });
        state.googleInitialized = true;
      }

      el.authGoogleWrap.innerHTML = "";
      window.google.accounts.id.renderButton(el.authGoogleWrap, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        logo_alignment: "left",
        width: 300
      });
      el.authHelper.textContent = "Google conecta o crea tu cuenta automaticamente.";
    } catch (error) {
      el.authGoogleWrap.innerHTML = "";
      el.authHelper.textContent = "No se pudo cargar el acceso con Google.";
      setMessage(error.message || "Error cargando Google", "error");
    }
  }

  function openAuthModal(message = "") {
    ensureModalDom();
    if (!el.authModal) return;

    const authenticated = isAuthenticated();
    if (el.authTitle) el.authTitle.textContent = authenticated ? "Sesion iniciada" : "Iniciar sesion";
    if (el.authSubtitle) {
      el.authSubtitle.textContent = authenticated
        ? `Has iniciado sesion como ${state.session?.user?.name || "usuario"}.`
        : "Accede con tu cuenta para sincronizar tus listas.";
    }

    if (el.authMode) el.authMode.hidden = authenticated || !state.config.localAuthEnabled;
    if (el.authForm) el.authForm.hidden = authenticated || !state.config.localAuthEnabled;
    if (!authenticated) setMode("login");

    el.authModal.classList.add("open");
    el.authModal.setAttribute("aria-hidden", "false");
    setMessage(message || "", "");

    // Renderizar el boton de Google cuando el modal ya es visible.
    setTimeout(() => {
      renderGoogleButton();
    }, 0);
  }

  function closeAuthModal() {
    if (!el.authModal) return;
    el.authModal.classList.remove("open");
    el.authModal.setAttribute("aria-hidden", "true");
  }

  async function refreshSession() {
    try {
      const json = await request(SESSION_URL, { method: "GET" });
      state.session = json && typeof json === "object" ? json : { authenticated: false };
    } catch {
      state.session = { authenticated: false };
    }
    updateHeaderUI();
    notify();
    return state.session;
  }

  async function fetchConfig() {
    try {
      const json = await request(CONFIG_URL, { method: "GET" });
      state.config = {
        ...state.config,
        ...(json || {})
      };
    } catch {
      state.config = {
        googleAuthEnabled: false,
        googleClientId: "",
        localAuthEnabled: true,
        passwordMinLen: 6
      };
    }
    return state.config;
  }

  async function logout() {
    try {
      await request(LOGOUT_URL, { method: "POST" });
    } catch {}
    return refreshSession();
  }

  async function init() {
    el.authTrigger = byId("authTrigger");
    el.logoutBtn = byId("logoutBtn");
    el.profileLink = byId("profileLink");
    el.profileLogo = byId("profileLogo") || document.querySelector(".profile-logo");
    el.profileAvatar = byId("profileAvatar");

    ensureModalDom();
    updateHeaderUI();

    if (el.authTrigger) {
      el.authTrigger.addEventListener("click", () => openAuthModal());
    }

    if (el.logoutBtn) {
      el.logoutBtn.addEventListener("click", async () => {
        await logout();
      });
    }

    if (el.profileLink) {
      el.profileLink.addEventListener("click", (event) => {
        if (isAuthenticated()) return;
        event.preventDefault();
        openAuthModal("Inicia sesion para acceder a Mi perfil.");
      });
    }

    await fetchConfig();
    await refreshSession();

    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "1") {
      openAuthModal();
    }

    return state.session;
  }

  function onChange(listener) {
    if (typeof listener !== "function") return () => {};
    state.listeners.push(listener);
    return () => {
      const index = state.listeners.indexOf(listener);
      if (index >= 0) state.listeners.splice(index, 1);
    };
  }

  function requireAuth(message = "Necesitas iniciar sesion para continuar.") {
    if (isAuthenticated()) return true;
    openAuthModal(message);
    return false;
  }

  function getSession() {
    return { ...state.session };
  }

  window.YVAuth = {
    init,
    onChange,
    refreshSession,
    openAuthModal,
    closeAuthModal,
    requireAuth,
    isAuthenticated,
    getSession,
    logout
  };
})();
