const SESSION_SECONDS = 60 * 60 * 24 * 30;
const VERIFY_SECONDS = 60 * 60;
const PBKDF2_ITERATIONS = 310000;

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }
  });
}
function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function clearCookie() {
  return "resona_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join(""); }
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return hex(bits);
}
function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
async function sendVerification(env, email, displayName, token, origin) {
  if (!env.RESEND_API_KEY || !env.RESONA_EMAIL_FROM) throw new Error("EMAIL_SERVICE_NOT_CONFIGURED");
  const link = `${origin}/api/auth?verify=${encodeURIComponent(token)}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "authorization": `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.RESONA_EMAIL_FROM,
      to: [email],
      subject: "Verify your Resona account",
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#17212b"><h1>Welcome to Resona, ${displayName.replace(/[&<>"]/g, "")}</h1><p>Confirm your email address to activate your account.</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#22d3ee;color:#041018;text-decoration:none;border-radius:8px">Verify email</a></p><p>This link expires in one hour. If you didn't create this account, you can ignore this message.</p></div>`
    })
  });
  if (!res.ok) throw new Error("EMAIL_SEND_FAILED");
}
async function createSession(db, userId) {
  const token = randomToken();
  const now = Date.now();
  await db.prepare("INSERT INTO auth_sessions (token_hash,user_id,expires_at,created_at) VALUES (?1,?2,?3,?4)")
    .bind(await sha256(token), userId, now + SESSION_SECONDS * 1000, now).run();
  return token;
}
async function currentUser(request, db) {
  const match = request.headers.get("cookie")?.match(/(?:^|;\s*)resona_session=([a-f0-9]{64})/);
  if (!match) return null;
  const row = await db.prepare(
    "SELECT u.id,u.email,u.display_name,u.email_verified_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?1 AND s.expires_at>?2"
  ).bind(await sha256(match[1]), Date.now()).first();
  return row || null;
}
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST" && request.method !== "GET") return response({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
  if (!env.DB) return response({ error: "Account storage is not configured." }, 503);
  const url = new URL(request.url);
  const origin = url.origin;
  if (request.method === "GET") {
    const token = url.searchParams.get("verify");
    if (token) {
      const tokenHash = await sha256(token);
      const row = await env.DB.prepare("SELECT user_id FROM email_verification_tokens WHERE token_hash=?1 AND expires_at>?2").bind(tokenHash, Date.now()).first();
      if (!row) return Response.redirect(origin + "/?auth=verification-expired", 302);
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET email_verified_at=?1,updated_at=?1 WHERE id=?2").bind(now, row.user_id),
        env.DB.prepare("DELETE FROM email_verification_tokens WHERE user_id=?1").bind(row.user_id)
      ]);
      return Response.redirect(origin + "/?auth=verified", 302);
    }
    const user = await currentUser(request, env.DB);
    return response({ user: user ? { id: user.id, email: user.email, displayName: user.display_name, emailVerified: !!user.email_verified_at } : null });
  }
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin && requestOrigin !== origin) return response({ error: "Cross-origin account requests are not allowed." }, 403);
  let body;
  try { body = await request.json(); } catch { return response({ error: "Invalid request." }, 400); }
  const action = String(body.action || "");
  try {
    if (action === "signup") {
      const email = String(body.email || "").trim().toLowerCase();
      const displayName = String(body.displayName || "").trim();
      const password = String(body.password || "");
      if (!validEmail(email)) return response({ error: "Enter a valid email address." }, 400);
      if (displayName.length < 2 || displayName.length > 40 || /[<>]/.test(displayName)) return response({ error: "Display name must be 2–40 characters." }, 400);
      if (password.length < 10 || password.length > 128) return response({ error: "Password must be 10–128 characters." }, 400);
      const existing = await env.DB.prepare("SELECT id FROM users WHERE email=?1").bind(email).first();
      if (existing) return response({ error: "An account with that email already exists. Try signing in." }, 409);
      const id = crypto.randomUUID(), salt = randomToken(), now = Date.now();
      const passwordHash = await hashPassword(password, salt);
      await env.DB.prepare("INSERT INTO users (id,email,display_name,password_hash,password_salt,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)")
        .bind(id, email, displayName, passwordHash, salt, now).run();
      const token = randomToken();
      await env.DB.prepare("INSERT INTO email_verification_tokens (token_hash,user_id,expires_at,created_at) VALUES (?1,?2,?3,?4)")
        .bind(await sha256(token), id, now + VERIFY_SECONDS * 1000, now).run();
      try { await sendVerification(env, email, displayName, token, origin); }
      catch (error) {
        await env.DB.prepare("DELETE FROM users WHERE id=?1").bind(id).run();
        if (error.message === "EMAIL_SERVICE_NOT_CONFIGURED") return response({ error: "Email delivery isn't configured yet. Please try again later." }, 503);
        return response({ error: "We couldn't send the verification email. Please try again later." }, 502);
      }
      return response({ message: "Account created. Check your email for a verification link." }, 201);
    }
    if (action === "login") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = await env.DB.prepare("SELECT id,email,display_name,password_hash,password_salt,email_verified_at FROM users WHERE email=?1").bind(email).first();
      if (!user) return response({ error: "Email or password is incorrect." }, 401);
      const candidate = await hashPassword(password, user.password_salt);
      if (candidate !== user.password_hash) return response({ error: "Email or password is incorrect." }, 401);
      if (!user.email_verified_at) return response({ error: "Please verify your email before signing in." }, 403);
      const token = await createSession(env.DB, user.id);
      return response({ user: { id: user.id, email: user.email, displayName: user.display_name, emailVerified: true } }, 200, { "set-cookie": cookie("resona_session", token, SESSION_SECONDS) });
    }
    if (action === "logout") {
      const match = request.headers.get("cookie")?.match(/(?:^|;\s*)resona_session=([a-f0-9]{64})/);
      if (match) await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?1").bind(await sha256(match[1])).run();
      return response({ ok: true }, 200, { "set-cookie": clearCookie() });
    }
    if (action === "profile") {
      const user = await currentUser(request, env.DB);
      if (!user) return response({ error: "Please sign in." }, 401);
      const displayName = String(body.displayName || "").trim();
      if (displayName.length < 2 || displayName.length > 40 || /[<>]/.test(displayName)) return response({ error: "Display name must be 2–40 characters." }, 400);
      await env.DB.prepare("UPDATE users SET display_name=?1,updated_at=?2 WHERE id=?3").bind(displayName, Date.now(), user.id).run();
      return response({ user: { id: user.id, email: user.email, displayName, emailVerified: true } });
    }
    return response({ error: "Unknown account action." }, 400);
  } catch (error) {
    console.error("Resona auth error:", error);
    return response({ error: "Account service is temporarily unavailable." }, 500);
  }
}
