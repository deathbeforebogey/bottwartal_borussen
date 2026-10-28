const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { loadEnvFile } = require("./utils/env");
const {
  createSupabaseAdminClient,
  createSupabaseClient,
  createSupabaseClientForSession,
  isSupabaseUnavailable,
} = require("./utils/supabase-node");
const { log } = require("./utils/log");

loadEnvFile();

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const ACCESS_COOKIE = "bwb_sb_access";
const REFRESH_COOKIE = "bwb_sb_refresh";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SUPABASE_UNAVAILABLE_MESSAGE =
  "Der Mitglieder-Dienst ist gerade nicht erreichbar. Bitte später erneut versuchen.";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self' https://api.openligadb.de",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  ...(process.env.NODE_ENV === "production"
    ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }
    : {}),
};

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  response.end(body);
};

const sendJson = (response, status, data, headers = {}) => {
  send(response, status, JSON.stringify(data), {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
};

const parseCookies = (request) =>
  Object.fromEntries(
    (request.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");
        return [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
      })
  );

const MAX_BODY_BYTES = 100 * 1024;

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const readJsonBody = async (request) => {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > MAX_BODY_BYTES) {
      throw httpError(413, "Anfrage zu groß.");
    }

    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    request.jsonBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return request.jsonBody;
  } catch (error) {
    throw httpError(400, "Ungültige Anfrage.");
  }
};

// Schreibende Anfragen nur von der eigenen Seite annehmen (Schutz vor CSRF).
const isSameOrigin = (request) => {
  const origin = request.headers.origin;

  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).host === request.headers.host;
  } catch (error) {
    return false;
  }
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RSVP_STATUSES = new Set(["yes", "maybe", "no"]);

const getTodayInBerlin = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

const getClientIp = (request) =>
  String(request.headers["x-forwarded-for"] || "").split(",")[0].trim() || request.socket.remoteAddress || "";

// Einfache Sperre gegen Passwort-Raten: 10 Fehlversuche pro IP und E-Mail in 15 Minuten.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const failedLogins = new Map();

const isLoginBlocked = (key) => {
  const entry = failedLogins.get(key);

  if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    failedLogins.delete(key);
    return false;
  }

  return entry.count >= LOGIN_MAX_FAILURES;
};

const recordFailedLogin = (key) => {
  // Alte Einträge gelegentlich aufräumen, damit die Liste nicht wächst.
  if (failedLogins.size > 1000) {
    failedLogins.forEach((value, mapKey) => {
      if (Date.now() - value.firstAt > LOGIN_WINDOW_MS) failedLogins.delete(mapKey);
    });
  }

  const entry = failedLogins.get(key);

  if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    failedLogins.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
};

const clearFailedLogins = (key) => failedLogins.delete(key);

const setAuthCookies = (response, session) => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", [
    `${ACCESS_COOKIE}=${encodeURIComponent(session.access_token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`,
    `${REFRESH_COOKIE}=${encodeURIComponent(session.refresh_token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`,
  ]);
};

const clearAuthCookies = (response) => {
  response.setHeader("Set-Cookie", [
    `${ACCESS_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    `${REFRESH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  ]);
};

const getSupabaseForRequest = async (request, response) => {
  const cookies = parseCookies(request);
  const accessToken = cookies[ACCESS_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];

  if (!accessToken || !refreshToken) {
    return { supabase: createSupabaseClient(), user: null };
  }

  const { supabase, session, error } = await createSupabaseClientForSession(accessToken, refreshToken);

  // Bei einem Supabase-Ausfall die Cookies behalten, damit niemand unnötig ausgeloggt wird.
  if (isSupabaseUnavailable(error)) {
    log("error", "Supabase nicht erreichbar (Session)", { error: error.message });
    throw httpError(503, SUPABASE_UNAVAILABLE_MESSAGE);
  }

  // setSession prüft den Token bereits bei Supabase, session.user ist also verifiziert.
  if (!session?.user) {
    clearAuthCookies(response);
    return { supabase, user: null };
  }

  // Supabase vergibt beim Erneuern einen neuen Refresh-Token; der alte wird ungültig.
  if (session.access_token !== accessToken || session.refresh_token !== refreshToken) {
    setAuthCookies(response, session);
  }

  response.userId = session.user.id;
  return { supabase, user: session.user };
};

// Nur app_metadata ist vertrauenswürdig: user_metadata kann jeder Nutzer selbst ändern.
const isAdminUser = (user) =>
  user?.app_metadata?.role === "admin" || user?.app_metadata?.is_admin === true;

const requireAdmin = async (request, response) => {
  const auth = await getSupabaseForRequest(request, response);

  if (!auth.user) {
    sendJson(response, 401, { error: "Nicht eingeloggt" });
    return null;
  }

  if (!isAdminUser(auth.user)) {
    sendJson(response, 403, { error: "Keine Admin-Berechtigung" });
    return null;
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    sendJson(response, 503, {
      error: "SUPABASE_SERVICE_ROLE_KEY fehlt auf dem Server.",
    });
    return null;
  }

  return { ...auth, admin };
};

const getBodyId = (body, pathname, prefix) =>
  body.id || pathname.slice(prefix.length).replace(/^\//, "");

const AUDIT_RESOURCES = {
  sections: "Startseiten-Block",
  content: "Texte",
  articles: "Artikel",
  events: "Termin",
  users: "Mitglied",
};
const AUDIT_ACTIONS = { POST: "angelegt", PUT: "geändert", DELETE: "gelöscht" };

// Protokolliert jede erfolgreiche Änderung im Adminbereich (wer, was, wann). Passwörter nie.
const writeAuditLog = async ({ admin, user }, request, response, pathname) => {
  const [, , , resource, targetId] = pathname.split("/");
  const body = request.jsonBody || {};
  const details = {};

  if (resource === "users") {
    if (body.role) details.role = body.role;
    if (body.password) details.passwordChanged = true;
  }

  const entry = {
    actor_id: user.id,
    actor_email: user.email,
    action: AUDIT_ACTIONS[request.method] || request.method,
    target_type: AUDIT_RESOURCES[resource] || resource,
    target_id: targetId || response.auditTargetId || null,
    target_label:
      response.auditLabel ||
      body.title ||
      body.email ||
      (Array.isArray(body.items) ? body.items.map((item) => item.key).join(", ") : "") ||
      "",
    details,
  };

  log("info", `Admin: ${entry.target_type} ${entry.action}`, { by: user.email, target: entry.target_label });

  const { error } = await admin.from("admin_audit_log").insert(entry);

  if (error) {
    log("error", "Protokolleintrag konnte nicht gespeichert werden", { error: error.message });
  }
};

const handleAdminApi = async (request, response, pathname) => {
  if (!pathname.startsWith("/api/admin/")) {
    return false;
  }

  const adminAuth = await requireAdmin(request, response);

  if (!adminAuth) {
    return true;
  }

  await routeAdminRequest(request, response, pathname, adminAuth);

  if (request.method !== "GET" && response.statusCode < 400) {
    await writeAuditLog(adminAuth, request, response, pathname);
  }

  return true;
};

const sendServerError = (response, error, context = "Datenbankfehler") => {
  log("error", context, { error: error.message, code: error.code });
  sendJson(response, 500, { error: error.message });
};

const routeAdminRequest = async (request, response, pathname, adminAuth) => {
  const { admin, user: currentUser } = adminAuth;

  if (pathname === "/api/admin/audit" && request.method === "GET") {
    const { data, error } = await admin
      .from("admin_audit_log")
      .select("created_at, actor_email, action, target_type, target_label, details")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      sendServerError(response, error, "Protokoll konnte nicht geladen werden");
      return true;
    }

    sendJson(response, 200, data, { "Cache-Control": "no-store" });
    return true;
  }

  if (pathname === "/api/admin/content" && request.method === "GET") {
    const { data, error } = await admin
      .from("site_content")
      .select("key, label, value")
      .order("key");

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, data, { "Cache-Control": "no-store" });
    return true;
  }

  if (pathname === "/api/admin/sections" && request.method === "GET") {
    const { data, error } = await admin
      .from("site_sections")
      .select("id, sort_order, type, eyebrow, title, body, button_label, button_url, visible, updated_at")
      .order("sort_order", { ascending: true });

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, data, { "Cache-Control": "no-store" });
    return true;
  }

  if (pathname === "/api/admin/sections" && request.method === "POST") {
    const body = await readJsonBody(request);
    const { data, error } = await admin
      .from("site_sections")
      .insert({
        sort_order: Number(body.sort_order || 100),
        type: body.type || "highlight",
        eyebrow: body.eyebrow || "",
        title: body.title,
        body: body.body || "",
        button_label: body.button_label || "",
        button_url: body.button_url || "",
        visible: Boolean(body.visible),
      })
      .select()
      .single();

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 201, data);
    return true;
  }

  if (pathname.startsWith("/api/admin/sections/") && request.method === "PUT") {
    const body = await readJsonBody(request);
    const id = getBodyId(body, pathname, "/api/admin/sections");
    const { data, error } = await admin
      .from("site_sections")
      .update({
        sort_order: Number(body.sort_order || 100),
        type: body.type || "highlight",
        eyebrow: body.eyebrow || "",
        title: body.title,
        body: body.body || "",
        button_label: body.button_label || "",
        button_url: body.button_url || "",
        visible: Boolean(body.visible),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, data);
    return true;
  }

  if (pathname.startsWith("/api/admin/sections/") && request.method === "DELETE") {
    const id = pathname.slice("/api/admin/sections/".length);
    const { data: deleted, error } = await admin.from("site_sections").delete().eq("id", id).select("title");
    response.auditLabel = deleted?.[0]?.title;

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/admin/content" && request.method === "PUT") {
    const body = await readJsonBody(request);
    const rows = Array.isArray(body.items) ? body.items : [];
    const { data, error } = await admin
      .from("site_content")
      .upsert(
        rows.map((item) => ({
          key: item.key,
          label: item.label || item.key,
          value: item.value || "",
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "key" }
      )
      .select("key, label, value");

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, data);
    return true;
  }

  if (pathname === "/api/admin/articles" && request.method === "GET") {
    const { data, error } = await admin
      .from("articles")
      .select("id, title, excerpt, body, published, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, data, { "Cache-Control": "no-store" });
    return true;
  }

  if (pathname === "/api/admin/articles" && request.method === "POST") {
    const body = await readJsonBody(request);
    const { data, error } = await admin
      .from("articles")
      .insert({
        title: body.title,
        excerpt: body.excerpt,
        body: body.body,
        published: Boolean(body.published),
      })
      .select()
      .single();

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 201, data);
    return true;
  }

  if (pathname.startsWith("/api/admin/articles/") && request.method === "PUT") {
    const body = await readJsonBody(request);
    const id = getBodyId(body, pathname, "/api/admin/articles");
    const { data, error } = await admin
      .from("articles")
      .update({
        title: body.title,
        excerpt: body.excerpt,
        body: body.body,
        published: Boolean(body.published),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, data);
    return true;
  }

  if (pathname.startsWith("/api/admin/articles/") && request.method === "DELETE") {
    const id = pathname.slice("/api/admin/articles/".length);
    const { data: deleted, error } = await admin.from("articles").delete().eq("id", id).select("title");
    response.auditLabel = deleted?.[0]?.title;

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/admin/events" && request.method === "GET") {
    const { data, error } = await admin
      .from("member_events")
      .select("id, event_date, day, month, event_time, title, description")
      .order("event_date", { ascending: true });

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, data, { "Cache-Control": "no-store" });
    return true;
  }

  if (pathname === "/api/admin/events" && request.method === "POST") {
    const body = await readJsonBody(request);
    const { data, error } = await admin
      .from("member_events")
      .insert({
        event_date: body.event_date,
        day: body.day,
        month: body.month,
        event_time: body.event_time,
        title: body.title,
        description: body.description,
      })
      .select()
      .single();

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 201, data);
    return true;
  }

  if (pathname.startsWith("/api/admin/events/") && request.method === "PUT") {
    const body = await readJsonBody(request);
    const id = getBodyId(body, pathname, "/api/admin/events");
    const { data, error } = await admin
      .from("member_events")
      .update({
        event_date: body.event_date,
        day: body.day,
        month: body.month,
        event_time: body.event_time,
        title: body.title,
        description: body.description,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, data);
    return true;
  }

  if (pathname.startsWith("/api/admin/events/") && request.method === "DELETE") {
    const id = pathname.slice("/api/admin/events/".length);
    const { data: deleted, error } = await admin.from("member_events").delete().eq("id", id).select("title");
    response.auditLabel = deleted?.[0]?.title;

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/admin/users" && request.method === "GET") {
    const { data, error } = await admin.auth.admin.listUsers();

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(
      response,
      200,
      data.users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.user_metadata?.display_name || "",
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        role: user.app_metadata?.role || "member",
      })),
      { "Cache-Control": "no-store" }
    );
    return true;
  }

  if (pathname === "/api/admin/users" && request.method === "POST") {
    const body = await readJsonBody(request);
    const { data, error } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { display_name: body.displayName || body.email },
      app_metadata: { role: body.role === "admin" ? "admin" : "member" },
    });

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 201, { id: data.user.id, email: data.user.email });
    return true;
  }

  if (pathname.startsWith("/api/admin/users/") && request.method === "PUT") {
    const body = await readJsonBody(request);
    const id = getBodyId(body, pathname, "/api/admin/users");

    if (id === currentUser.id && body.role && body.role !== "admin") {
      sendJson(response, 400, { error: "Du kannst dir die Admin-Rolle nicht selbst entziehen." });
      return true;
    }

    const { data: existingUserData, error: getUserError } = await admin.auth.admin.getUserById(id);

    if (getUserError || !existingUserData.user) {
      sendJson(response, 404, { error: "Mitglied nicht gefunden." });
      return true;
    }

    const existingUser = existingUserData.user;
    const updates = {};

    if (body.email) updates.email = body.email;
    if (body.password) updates.password = body.password;
    if (body.role) {
      updates.app_metadata = {
        ...(existingUser.app_metadata || {}),
        role: body.role === "admin" ? "admin" : "member",
      };
    }
    if (Object.prototype.hasOwnProperty.call(body, "displayName")) {
      updates.user_metadata = {
        ...(existingUser.user_metadata || {}),
        display_name: String(body.displayName || "").trim() || body.email || existingUser.email,
      };
    }

    const { data, error } = await admin.auth.admin.updateUserById(id, updates);

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, {
      id: data.user.id,
      email: data.user.email,
      displayName: data.user.user_metadata?.display_name || "",
      role: data.user.app_metadata?.role || "member",
    });
    return true;
  }

  if (pathname.startsWith("/api/admin/users/") && request.method === "DELETE") {
    const id = pathname.slice("/api/admin/users/".length);

    if (id === currentUser.id) {
      sendJson(response, 400, { error: "Du kannst dein eigenes Konto nicht löschen." });
      return true;
    }

    const { data: userToDelete } = await admin.auth.admin.getUserById(id);
    response.auditLabel = userToDelete?.user?.email;
    const { error } = await admin.auth.admin.deleteUser(id);

    if (error) {
      sendServerError(response, error);
      return true;
    }

    sendJson(response, 200, { ok: true });
    return true;
  }

  sendJson(response, 404, { error: "Admin-Endpunkt nicht gefunden" });
  return true;
};

const handleApi = async (request, response, pathname) => {
  const handledAdminApi = await handleAdminApi(request, response, pathname);

  if (handledAdminApi) {
    return true;
  }

  // Für Uptime-Monitoring: prüft, ob die Datenbank erreichbar ist.
  if (pathname === "/api/health" && request.method === "GET") {
    let ok = false;

    try {
      const { error } = await createSupabaseClient()
        .from("site_content")
        .select("key", { head: true, count: "exact" });
      ok = !error;

      if (error) {
        log("error", "Health-Check: Datenbank nicht erreichbar", { error: error.message });
      }
    } catch (error) {
      log("error", "Health-Check: Supabase-Konfiguration fehlt", { error: error.message });
    }

    sendJson(response, ok ? 200 : 503, { ok, database: ok ? "erreichbar" : "nicht erreichbar" }, {
      "Cache-Control": "no-store",
    });
    return true;
  }

  if (pathname === "/api/session" && request.method === "GET") {
    const { user } = await getSupabaseForRequest(request, response);
    sendJson(response, 200, {
      authenticated: Boolean(user),
      user: user
        ? {
            id: user.id,
            email: user.email,
            displayName: user.user_metadata?.display_name || user.email,
            isAdmin: isAdminUser(user),
          }
        : null,
    });
    return true;
  }

  if (pathname === "/api/site/content" && request.method === "GET") {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.from("site_content").select("key, value");

    // Die Startseite zeigt dann ihre eingebauten Standardtexte.
    if (error) {
      log("error", "Seitentexte konnten nicht geladen werden", { error: error.message });
      sendJson(response, 200, {});
      return true;
    }

    sendJson(response, 200, Object.fromEntries(data.map((item) => [item.key, item.value])));
    return true;
  }

  if (pathname === "/api/site/sections" && request.method === "GET") {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("site_sections")
      .select("id, sort_order, type, eyebrow, title, body, button_label, button_url")
      .eq("visible", true)
      .order("sort_order", { ascending: true });

    if (error) {
      log("error", "Startseiten-Blöcke konnten nicht geladen werden", { error: error.message });
      sendJson(response, 200, []);
      return true;
    }

    sendJson(response, 200, data);
    return true;
  }

  if (pathname === "/api/site/articles" && request.method === "GET") {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("articles")
      .select("id, title, excerpt, body, created_at")
      .eq("published", true)
      .order("created_at", { ascending: false })
      .limit(6);

    if (error) {
      log("error", "Artikel konnten nicht geladen werden", { error: error.message });
      sendJson(response, 503, { error: "Meldungen konnten nicht geladen werden." });
      return true;
    }

    sendJson(response, 200, data, { "Cache-Control": "no-store" });
    return true;
  }

  if (pathname === "/api/login" && request.method === "POST") {
    const body = await readJsonBody(request);
    const email = String(body.email || body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const ip = getClientIp(request);
    const limitKey = `${ip}|${email}`;

    if (isLoginBlocked(limitKey)) {
      log("warn", "Login gesperrt (zu viele Fehlversuche)", { email, ip });
      sendJson(response, 429, {
        error: "Zu viele Fehlversuche. Bitte warte 15 Minuten und versuche es dann erneut.",
      });
      return true;
    }

    let result;

    try {
      result = await createSupabaseClient().auth.signInWithPassword({ email, password });
    } catch (error) {
      log("error", "Login fehlgeschlagen: Supabase-Konfiguration", { error: error.message });
      sendJson(response, 503, { error: SUPABASE_UNAVAILABLE_MESSAGE });
      return true;
    }

    const { data, error } = result;

    if (isSupabaseUnavailable(error)) {
      log("error", "Login fehlgeschlagen: Supabase nicht erreichbar", { error: error.message });
      sendJson(response, 503, { error: SUPABASE_UNAVAILABLE_MESSAGE });
      return true;
    }

    if (error || !data.session) {
      recordFailedLogin(limitKey);
      log("warn", "Login abgelehnt", { email, ip, reason: error?.message });
      sendJson(response, 401, { error: "E-Mail oder Passwort ist falsch." });
      return true;
    }

    clearFailedLogins(limitKey);
    setAuthCookies(response, data.session);
    log("info", "Login erfolgreich", { user: data.user.id.slice(0, 8) });
    sendJson(response, 200, { authenticated: true });
    return true;
  }

  if (pathname === "/api/logout" && request.method === "POST") {
    // Auch wenn Supabase gerade nicht erreichbar ist: lokal immer ausloggen.
    try {
      const { supabase } = await getSupabaseForRequest(request, response);
      await supabase.auth.signOut();
    } catch (error) {
      log("warn", "Abmelden bei Supabase fehlgeschlagen", { error: error.message });
    }

    clearAuthCookies(response);
    sendJson(response, 200, { authenticated: false });
    return true;
  }

  if (pathname === "/api/member/terms" && request.method === "GET") {
    const { supabase, user } = await getSupabaseForRequest(request, response);

    if (!user) {
      sendJson(response, 401, { error: "Nicht eingeloggt" });
      return true;
    }

    // Vergangene Termine ausblenden.
    const { data, error } = await supabase
      .from("member_events")
      .select("id, event_date, day, month, event_time, title, description")
      .gte("event_date", getTodayInBerlin())
      .order("event_date", { ascending: true });

    if (error) {
      log("error", "Termine konnten nicht geladen werden", { error: error.message });
      sendJson(response, 500, { error: "Termine konnten nicht geladen werden." });
      return true;
    }

    // Fehlt die Tabelle event_rsvps noch, werden die Termine trotzdem angezeigt.
    const { data: rsvpData, error: rsvpError } = data.length
      ? await supabase
          .from("event_rsvps")
          .select("event_id, user_id, display_name, status, comment")
          .in("event_id", data.map((event) => event.id))
          .order("updated_at", { ascending: true })
      : { data: [], error: null };

    if (rsvpError) {
      log("warn", "Zusagen konnten nicht geladen werden", { error: rsvpError.message });
    }

    const rsvps = rsvpError ? [] : rsvpData;

    sendJson(
      response,
      200,
      data.map((event) => ({
        id: event.id,
        date: event.event_date,
        day: event.day,
        month: event.month,
        time: event.event_time,
        title: event.title,
        description: event.description,
        rsvpEnabled: !rsvpError,
        rsvps: rsvps
          .filter((rsvp) => rsvp.event_id === event.id)
          .map((rsvp) => ({
            name: rsvp.display_name,
            status: rsvp.status,
            comment: rsvp.comment,
            isMe: rsvp.user_id === user.id,
          })),
      })),
      { "Cache-Control": "no-store" }
    );
    return true;
  }

  const rsvpMatch = pathname.match(/^\/api\/member\/terms\/([^/]+)\/rsvp$/);

  if (rsvpMatch && request.method === "PUT") {
    const { supabase, user } = await getSupabaseForRequest(request, response);

    if (!user) {
      sendJson(response, 401, { error: "Nicht eingeloggt" });
      return true;
    }

    const eventId = rsvpMatch[1];
    const body = await readJsonBody(request);
    const status = String(body.status || "");
    const comment = String(body.comment || "").trim().slice(0, 300);

    if (!UUID_PATTERN.test(eventId) || !RSVP_STATUSES.has(status)) {
      sendJson(response, 400, { error: "Ungültige Angaben." });
      return true;
    }

    // Läuft mit der Session des Mitglieds: RLS erlaubt nur die eigene Antwort.
    const { error } = await supabase.from("event_rsvps").upsert(
      {
        event_id: eventId,
        user_id: user.id,
        display_name: user.user_metadata?.display_name || user.email,
        status,
        comment,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "event_id,user_id" }
    );

    if (error) {
      log("error", "Zusage konnte nicht gespeichert werden", { error: error.message, event: eventId });
      sendJson(response, 500, { error: "Antwort konnte nicht gespeichert werden." });
      return true;
    }

    log("info", "Zusage gespeichert", { user: user.id.slice(0, 8), event: eventId, status });
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "API-Endpunkt nicht gefunden" });
    return true;
  }

  return false;
};

// Nur diese Dateien sind öffentlich. Alles andere (.env.local, .git, server.js, ...) bleibt verborgen.
const PUBLIC_FILES = new Set([
  "/index.html",
  "/login.html",
  "/members.html",
  "/admin.html",
  "/impressum.html",
  "/datenschutz.html",
  "/styles.css",
  "/design.css",
  "/script.js",
  "/auth.js",
  "/members.js",
  "/admin.js",
]);
const PUBLIC_DIRS = ["/assets/"];

const isPublicPath = (requestedPath) =>
  PUBLIC_FILES.has(requestedPath) || PUBLIC_DIRS.some((dir) => requestedPath.startsWith(dir));

const serveStatic = async (request, response, pathname) => {
  let requestedPath;

  try {
    requestedPath = path.posix.normalize(decodeURIComponent(pathname === "/" ? "/index.html" : pathname));
  } catch (error) {
    send(response, 400, "Bad request", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  const absolutePath = path.join(ROOT, requestedPath);

  if (!isPublicPath(requestedPath) || !absolutePath.startsWith(ROOT + path.sep)) {
    send(response, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  if (requestedPath === "/members.html" || requestedPath === "/admin.html") {
    const { user } = await getSupabaseForRequest(request, response);

    if (user && (requestedPath === "/members.html" || isAdminUser(user))) {
      const file = await fs.readFile(absolutePath);
      send(response, 200, file, { "Content-Type": "text/html; charset=utf-8" });
      return;
    }

    send(response, 302, "", { Location: `/login.html?next=${encodeURIComponent(requestedPath)}` });
    return;
  }

  try {
    const file = await fs.readFile(absolutePath);
    const contentType = mimeTypes[path.extname(absolutePath)] || "application/octet-stream";
    send(response, 200, file, { "Content-Type": contentType });
  } catch (error) {
    send(response, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
  }
};

const isPageOrApi = (pathname) => pathname.startsWith("/api/") || pathname === "/" || pathname.endsWith(".html");

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  // Ein Log-Eintrag pro Seiten- und API-Aufruf; CSS, JS und Bilder nur bei Fehlern.
  response.on("finish", () => {
    if (!isPageOrApi(pathname) && response.statusCode < 400) {
      return;
    }

    log(response.statusCode >= 500 ? "error" : "info", `${request.method} ${pathname}`, {
      status: response.statusCode,
      ms: Date.now() - startedAt,
      user: response.userId?.slice(0, 8),
    });
  });

  try {
    if (pathname.startsWith("/api/") && request.method !== "GET" && !isSameOrigin(request)) {
      sendJson(response, 403, { error: "Anfrage von fremder Seite abgelehnt." });
      return;
    }

    const handled = await handleApi(request, response, pathname);

    if (!handled) {
      await serveStatic(request, response, pathname);
    }
  } catch (error) {
    if (response.headersSent) {
      log("error", "Fehler nach dem Senden der Antwort", { path: pathname, error: error.message });
      response.end();
      return;
    }

    const status = error.statusCode || 500;

    if (!error.statusCode) {
      log("error", "Unerwarteter Serverfehler", { path: pathname, error: error.stack || error.message });
    }

    const message = error.statusCode ? error.message : "Serverfehler. Bitte später erneut versuchen.";

    if (pathname.startsWith("/api/")) {
      sendJson(response, status, { error: message });
    } else {
      send(response, status, message, { "Content-Type": "text/plain; charset=utf-8" });
    }
  }
});

server.listen(PORT, () => {
  log("info", `Bottwartal Borussen läuft auf http://127.0.0.1:${PORT}`);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    log("error", "Supabase URL oder Publishable Key fehlt. Login und Mitgliederbereich funktionieren nicht.");
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    log("warn", "SUPABASE_SERVICE_ROLE_KEY fehlt. Der Adminbereich funktioniert nicht.");
  }
});
