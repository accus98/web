const el = {
  resetHint: document.getElementById("resetHint"),
  resetForm: document.getElementById("resetForm"),
  resetPassword: document.getElementById("resetPassword"),
  resetPasswordConfirm: document.getElementById("resetPasswordConfirm"),
  resetSubmit: document.getElementById("resetSubmit"),
  resetMessage: document.getElementById("resetMessage")
};

const PASSWORD_MIN_LEN = 8;
const RESET_URL = "/api/auth/password/reset";

function passwordPolicyMessage() {
  return `La contrasena debe tener al menos ${PASSWORD_MIN_LEN} caracteres, una letra y un numero.`;
}

function isPasswordStrong(password) {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN_LEN) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  return true;
}

function setMessage(message = "", type = "") {
  if (!el.resetMessage) return;
  el.resetMessage.textContent = String(message || "");
  el.resetMessage.className = "auth-message";
  if (type) el.resetMessage.classList.add(type);
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

function setFormEnabled(enabled) {
  const active = Boolean(enabled);
  if (el.resetPassword) el.resetPassword.disabled = !active;
  if (el.resetPasswordConfirm) el.resetPasswordConfirm.disabled = !active;
  if (el.resetSubmit) el.resetSubmit.disabled = !active;
}

async function handleSubmit(event, token) {
  event.preventDefault();
  if (!token) {
    setMessage("Token de restablecimiento invalido.", "error");
    return;
  }

  const password = String(el.resetPassword?.value || "");
  const confirm = String(el.resetPasswordConfirm?.value || "");
  if (!isPasswordStrong(password)) {
    setMessage(passwordPolicyMessage(), "error");
    return;
  }
  if (password !== confirm) {
    setMessage("La confirmacion no coincide.", "error");
    return;
  }

  setMessage("Restableciendo contrasena...", "success");
  setFormEnabled(false);
  try {
    await request(RESET_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token,
        newPassword: password
      })
    });
    setMessage("Contrasena actualizada. Redirigiendo a tu perfil...", "success");
    setTimeout(() => {
      window.location.href = "profile.html";
    }, 900);
  } catch (error) {
    setMessage(error.message || "No se pudo restablecer la contrasena.", "error");
    setFormEnabled(true);
  }
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
    setFormEnabled(false);
    if (el.resetHint) {
      el.resetHint.textContent = "El enlace no es valido. Solicita uno nuevo desde Iniciar sesion.";
    }
    setMessage("Falta token de recuperacion.", "error");
    return;
  }

  if (el.resetForm) {
    el.resetForm.addEventListener("submit", (event) => {
      handleSubmit(event, token);
    });
  }
}

main();
