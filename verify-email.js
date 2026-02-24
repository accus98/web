const el = {
  verifyHint: document.getElementById("verifyHint"),
  verifyMessage: document.getElementById("verifyMessage"),
  verifyProfileLink: document.getElementById("verifyProfileLink")
};

const VERIFY_URL = "/api/auth/email/verify";

function setMessage(message = "", type = "") {
  if (!el.verifyMessage) return;
  el.verifyMessage.textContent = String(message || "");
  el.verifyMessage.className = "auth-message";
  if (type) el.verifyMessage.classList.add(type);
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

async function verifyToken(token) {
  await request(VERIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token })
  });
}

async function main() {
  if (window.YVAuth?.init) {
    try {
      await window.YVAuth.init();
    } catch {}
  }

  const params = new URLSearchParams(window.location.search);
  const token = String(params.get("token") || "").trim();

  if (!token) {
    if (el.verifyHint) el.verifyHint.textContent = "Falta token de verificacion. Solicita reenviar el correo.";
    setMessage("Enlace invalido.", "error");
    return;
  }

  if (el.verifyHint) el.verifyHint.textContent = "Comprobando enlace de verificacion...";
  setMessage("Verificando correo...", "success");

  try {
    await verifyToken(token);
    if (el.verifyHint) el.verifyHint.textContent = "Correo verificado. Tu cuenta ya esta activa.";
    if (el.verifyProfileLink) el.verifyProfileLink.hidden = false;
    setMessage("Listo. Redirigiendo a tu perfil...", "success");
    setTimeout(() => {
      window.location.href = "profile.html";
    }, 900);
  } catch (error) {
    if (el.verifyHint) el.verifyHint.textContent = "No se pudo activar la cuenta con este enlace.";
    setMessage(error.message || "No se pudo verificar el correo.", "error");
  }
}

main();
