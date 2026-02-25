const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomPort() {
  return 10000 + Math.floor(Math.random() * 20000);
}

async function waitForServer(baseUrl, timeoutMs = 18000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Servidor no disponible en ${baseUrl}`);
}

function parseSetCookie(headerValue) {
  const raw = String(headerValue || "").trim();
  if (!raw) return "";
  return raw.split(";")[0].trim();
}

async function postJson(baseUrl, route, body, cookie = "", extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extraHeaders
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  return {
    status: res.status,
    data,
    cookie: parseSetCookie(res.headers.get("set-cookie"))
  };
}

function sanitizeForRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLogUrls(logText, prefix, email) {
  const safePrefix = sanitizeForRegex(prefix);
  const safeEmail = sanitizeForRegex(email);
  const re = new RegExp(`\\[${safePrefix}\\]\\s+${safeEmail}\\s+->\\s+(\\S+)`, "g");
  const out = [];
  let match = null;
  while ((match = re.exec(logText))) {
    out.push(match[1]);
  }
  return out;
}

async function startFixture(t) {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "yv-auth-test-"));
  const port = randomPort();
  const baseUrl = `http://localhost:${port}`;

  const env = {
    ...process.env,
    PORT: String(port),
    APP_BASE_URL: baseUrl,
    SESSION_SECRET: "test_session_secret_abcdefghijklmnopqrstuvwxyz_12345",
    NODE_ENV: "test",
    YV_DATA_DIR: dataDir,
    // Evita enviar correos reales durante tests locales.
    SMTP_HOST: "",
    SMTP_PORT: "",
    SMTP_SECURE: "",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM: ""
  };

  const proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let logs = "";
  proc.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  proc.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  t.after(async () => {
    try {
      proc.kill("SIGTERM");
    } catch {}
    await sleep(220);
    try {
      await fsp.rm(dataDir, { recursive: true, force: true });
    } catch {}
  });

  await waitForServer(baseUrl);

  return {
    baseUrl,
    dataDir,
    getLogs: () => logs
  };
}

test("registro local requiere verificacion de correo y luego permite login", async (t) => {
  const fx = await startFixture(t);
  const email = `verify+${Date.now()}@example.com`;

  const register = await postJson(fx.baseUrl, "/api/auth/register", {
    email,
    password: "abc12345",
    name: "Verifier"
  });
  assert.equal(register.status, 200);
  assert.equal(register.data.authenticated, false);
  assert.equal(register.data.requiresEmailVerification, true);

  const loginBefore = await postJson(fx.baseUrl, "/api/auth/login", {
    email,
    password: "abc12345"
  });
  assert.equal(loginBefore.status, 403);
  assert.equal(loginBefore.data.needsEmailVerification, true);

  const resend = await postJson(fx.baseUrl, "/api/auth/email/resend", { email });
  assert.equal(resend.status, 200);
  assert.equal(resend.data.ok, true);

  let verifyUrl = "";
  for (let i = 0; i < 30; i += 1) {
    await sleep(120);
    const urls = findLogUrls(fx.getLogs(), "email-verify", email);
    if (urls.length) {
      verifyUrl = urls[urls.length - 1];
      break;
    }
  }
  assert.ok(verifyUrl, "No se encontro URL de verificacion en logs");

  const verifyToken = new URL(verifyUrl).searchParams.get("token");
  assert.ok(verifyToken, "Token de verificacion vacio");

  const verify = await postJson(fx.baseUrl, "/api/auth/email/verify", { token: verifyToken });
  assert.equal(verify.status, 200);
  assert.equal(verify.data.authenticated, true);
  assert.equal(verify.data.user.emailVerified, true);

  const loginAfter = await postJson(fx.baseUrl, "/api/auth/login", {
    email,
    password: "abc12345"
  });
  assert.equal(loginAfter.status, 200);
  assert.equal(loginAfter.data.authenticated, true);
});

test("reset invalida tokens anteriores del mismo usuario", async (t) => {
  const fx = await startFixture(t);
  const email = `reset+${Date.now()}@example.com`;

  const register = await postJson(fx.baseUrl, "/api/auth/register", {
    email,
    password: "oldpass123",
    name: "Reset User"
  });
  assert.equal(register.status, 200);
  assert.equal(register.data.requiresEmailVerification, true);

  let verifyUrl = "";
  for (let i = 0; i < 30; i += 1) {
    await sleep(120);
    const urls = findLogUrls(fx.getLogs(), "email-verify", email);
    if (urls.length) {
      verifyUrl = urls[urls.length - 1];
      break;
    }
  }
  assert.ok(verifyUrl, "No se encontro URL de verificacion");

  const verifyToken = new URL(verifyUrl).searchParams.get("token");
  assert.ok(verifyToken);
  const verify = await postJson(fx.baseUrl, "/api/auth/email/verify", { token: verifyToken });
  assert.equal(verify.status, 200);

  await postJson(fx.baseUrl, "/api/auth/password/forgot", { email });
  await postJson(fx.baseUrl, "/api/auth/password/forgot", { email });

  let resetUrls = [];
  for (let i = 0; i < 30; i += 1) {
    await sleep(120);
    resetUrls = findLogUrls(fx.getLogs(), "password-reset", email);
    if (resetUrls.length >= 2) break;
  }
  assert.ok(resetUrls.length >= 2, "No se encontraron 2 enlaces de reset");

  const token1 = new URL(resetUrls[resetUrls.length - 2]).searchParams.get("token");
  const token2 = new URL(resetUrls[resetUrls.length - 1]).searchParams.get("token");
  assert.ok(token1);
  assert.ok(token2);
  assert.notEqual(token1, token2);

  const reset2 = await postJson(fx.baseUrl, "/api/auth/password/reset", {
    token: token2,
    newPassword: "newpass123"
  });
  assert.equal(reset2.status, 200);
  assert.equal(reset2.data.authenticated, true);

  const reset1 = await postJson(fx.baseUrl, "/api/auth/password/reset", {
    token: token1,
    newPassword: "anotherpass123"
  });
  assert.equal(reset1.status, 400);

  const loginNew = await postJson(fx.baseUrl, "/api/auth/login", {
    email,
    password: "newpass123"
  });
  assert.equal(loginNew.status, 200);
  assert.equal(loginNew.data.authenticated, true);

  const loginOld = await postJson(fx.baseUrl, "/api/auth/login", {
    email,
    password: "oldpass123"
  });
  assert.notEqual(loginOld.status, 200);
});

test("registro local rechaza contrasenas que no cumplen politica", async (t) => {
  const fx = await startFixture(t);
  const baseEmail = `policy+${Date.now()}`;

  const onlyLetters = await postJson(fx.baseUrl, "/api/auth/register", {
    email: `${baseEmail}-letters@example.com`,
    password: "sololetras",
    name: "Policy User"
  });
  assert.equal(onlyLetters.status, 400);
  assert.match(String(onlyLetters.data?.error || ""), /contrasena/i);

  const onlyNumbers = await postJson(fx.baseUrl, "/api/auth/register", {
    email: `${baseEmail}-numbers@example.com`,
    password: "12345678",
    name: "Policy User"
  });
  assert.equal(onlyNumbers.status, 400);
  assert.match(String(onlyNumbers.data?.error || ""), /contrasena/i);
});

test("bloquea peticiones API con origin cruzado en metodos stateful", async (t) => {
  const fx = await startFixture(t);
  const blocked = await postJson(
    fx.baseUrl,
    "/api/auth/logout",
    {},
    "",
    {
      Origin: "https://evil.example",
      Referer: "https://evil.example/fake"
    }
  );
  assert.equal(blocked.status, 403);
  assert.match(String(blocked.data?.error || ""), /seguridad/i);
});

test("auditoria de seguridad escribe eventos de auth en archivo", async (t) => {
  const fx = await startFixture(t);
  const email = `audit+${Date.now()}@example.com`;

  await postJson(fx.baseUrl, "/api/auth/register", {
    email,
    password: "auditpass123",
    name: "Audit User"
  });

  let verifyUrl = "";
  for (let i = 0; i < 30; i += 1) {
    await sleep(120);
    const urls = findLogUrls(fx.getLogs(), "email-verify", email);
    if (urls.length) {
      verifyUrl = urls[urls.length - 1];
      break;
    }
  }
  assert.ok(verifyUrl);
  const verifyToken = new URL(verifyUrl).searchParams.get("token");
  await postJson(fx.baseUrl, "/api/auth/email/verify", { token: verifyToken });

  await postJson(fx.baseUrl, "/api/auth/password/forgot", { email });
  await sleep(220);

  const securityLogPath = path.join(fx.dataDir, "security.log");
  assert.ok(fs.existsSync(securityLogPath), "No se encontro security.log");
  const raw = await fsp.readFile(securityLogPath, "utf8");
  assert.ok(raw.includes("\"event\":\"auth_register_verification_required\""));
  assert.ok(raw.includes("\"event\":\"auth_email_verify_success\""));
  assert.ok(raw.includes("\"event\":\"auth_password_forgot_success\""));
});
