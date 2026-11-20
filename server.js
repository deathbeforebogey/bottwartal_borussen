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
  ".woff2": "font/woff2",
};

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Alles wird von der eigenen Domain geladen: keine Google-Fonts- oder Spielplan-Abrufe
// aus dem Browser, damit keine IP-Adressen von Besuchern an Dritte gehen (DSGVO).
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(IS_PRODUCTION ? ["upgrade-insecure-requests"] : []),
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  ...(IS_PRODUCTION ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
};

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  response.end(body);
};

// API-Antworten enthalten oft persönliche Daten: standardmäßig nicht zwischenspeichern.
const sendJson = (response, status, data, headers = {}) => {
  send(response, status, JSON.stringify(data), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
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
  // Nur echtes JSON annehmen: HTML-Formulare fremder Seiten können kein JSON senden.
  if (!/^application\/json\b/i.test(request.headers["content-type"] || "")) {
    throw httpError(415, "Ungültige Anfrage.");
  }

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
  const fetchSite = request.headers["sec-fetch-site"];

  // Moderne Browser verraten, ob die Anfrage von einer fremden Seite stammt.
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

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

// X-Forwarded-For kann jeder Client selbst setzen. Nur hinter einem eigenen Proxy
// (TRUST_PROXY=1 beim Hoster) ist der Header vertrauenswürdig; sonst ließe sich die
// Login-Sperre mit wechselnden Fantasie-IPs umgehen.
const getClientIp = (request) =>
  (process.env.TRUST_PROXY === "1" &&
    String(request.headers["x-forwarded-for"] || "").split(",")[0].trim()) ||
  request.socket.remoteAddress ||
  "";

// Für Logs: "max.mustermann@web.de" -> "ma***@web.de"
const maskEmail = (email = "") => String(email).replace(/^(.{0,2})[^@]*@/, "$1***@");

// Zählt Fehlversuche je Schlüssel in einem Zeitfenster (Schutz gegen Passwort-Raten).
const createLimiter = (maxFailures, windowMs = 15 * 60 * 1000) => {
  const entries = new Map();

  const current = (key) => {
    const entry = entries.get(key);

    if (entry && Date.now() - entry.firstAt > windowMs) {
      entries.delete(key);
      return null;
    }

    return entry || null;
  };

  return {
    isBlocked: (key) => (current(key)?.count || 0) >= maxFailures,
    fail: (key) => {
      // Alte Einträge gelegentlich aufräumen, damit die Liste nicht wächst.
      if (entries.size > 5000) {
        entries.forEach((value, mapKey) => {
          if (Date.now() - value.firstAt > windowMs) entries.delete(mapKey);
        });
      }

      const entry = current(key);

      if (entry) {
        entry.count += 1;
      } else {
        entries.set(key, { count: 1, firstAt: Date.now() });
      }
    },
    clear: (key) => entries.delete(key),
  };
};

// Login: 10 Fehlversuche je IP+Konto, 30 je IP (viele Konten durchprobieren),
// 20 je Konto (verteilte Angriffe über viele IPs) in 15 Minuten.
const loginByIpAndEmail = createLimiter(10);
const loginByIp = createLimiter(30);
const loginByEmail = createLimiter(20);
const passwordChangeByUser = createLimiter(5);

const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 72;

const validatePassword = (password) => {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Das Passwort braucht mindestens ${PASSWORD_MIN_LENGTH} Zeichen.`;
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Das Passwort darf höchstens ${PASSWORD_MAX_LENGTH} Zeichen haben.`;
  }

  return "";
};

// Anzeigenamen: 2–40 Zeichen, keine Steuerzeichen.
const cleanDisplayName = (value) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);

// Nur Anker, interne Pfade, http(s) und mailto zulassen, keine javascript:-Links.
const isSafeUrl = (url = "") => /^(#|\/(?![/\\])|https?:\/\/|mailto:)/i.test(String(url).trim());

const setAuthCookies = (response, session) => {
  const secure = IS_PRODUCTION ? "; Secure" : "";
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

// Die ID kommt immer aus der URL und muss eine UUID sein.
const getPathId = (pathname, prefix) => {
  const id = pathname.slice(prefix.length).replace(/^\//, "");

  if (!UUID_PATTERN.test(id)) {
    throw httpError(400, "Ungültige ID.");
  }

  return id;
};

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

// Details nur ins Server-Log; der Browser bekommt keine Datenbank-Interna zu sehen.
const sendServerError = (response, error, context = "Datenbankfehler") => {
  log("error", context, { error: error.message, code: error.code });
  const missingTable = error.code === "42P01" || error.code === "PGRST205";
  sendJson(response, 500, {
    error: missingTable
      ? "Tabelle fehlt. Bitte supabase/setup.sql in Supabase ausführen."
      : "Speichern oder Laden ist fehlgeschlagen. Details stehen im Server-Log.",
  });
};

const validateSectionBody = (body) => {
  if (!String(body.title || "").trim()) {
    throw httpError(400, "Der Block braucht einen Titel.");
  }

  if (body.button_url && !isSafeUrl(body.button_url)) {
    throw httpError(400, "Button-Link muss mit #, /, https:// oder mailto: beginnen.");
  }
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
    validateSectionBody(body);
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
    const id = getPathId(pathname, "/api/admin/sections");
    const body = await readJsonBody(request);
    validateSectionBody(body);
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
    const id = getPathId(pathname, "/api/admin/sections");
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
    const id = getPathId(pathname, "/api/admin/articles");
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
    const id = getPathId(pathname, "/api/admin/articles");
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
    const id = getPathId(pathname, "/api/admin/events");
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
    const id = getPathId(pathname, "/api/admin/events");
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
    const passwordError = validatePassword(String(body.password || ""));

    if (passwordError) {
      sendJson(response, 400, { error: passwordError });
      return true;
    }

    const { data, error } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { display_name: cleanDisplayName(body.displayName) || body.email },
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
    const id = getPathId(pathname, "/api/admin/users");
    const body = await readJsonBody(request);

    if (body.password) {
      const passwordError = validatePassword(String(body.password));

      if (passwordError) {
        sendJson(response, 400, { error: passwordError });
        return true;
      }
    }

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
        display_name: cleanDisplayName(body.displayName) || body.email || existingUser.email,
      };
    }

    const { data, error } = await admin.auth.admin.updateUserById(id, updates);

    if (error) {
      sendServerError(response, error);
      return true;
    }

    // Mitgliederliste und Zusagen zeigen den neuen Namen ebenfalls.
    if (updates.user_metadata?.display_name) {
      await syncDisplayName(admin, id, updates.user_metadata.display_name);
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
    const id = getPathId(pathname, "/api/admin/users");

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

// Name in Profil und bisherigen Zusagen nachziehen. Fehlt die Tabelle noch, nur loggen.
const syncDisplayName = async (client, userId, displayName) => {
  const results = await Promise.all([
    client.from("profiles").update({ display_name: displayName, updated_at: new Date().toISOString() }).eq("id", userId),
    client.from("event_rsvps").update({ display_name: displayName }).eq("user_id", userId),
  ]);

  results.forEach(({ error }) => {
    if (error) log("warn", "Anzeigename konnte nicht überall aktualisiert werden", { error: error.message });
  });
};

// Spielplan serverseitig von OpenLigaDB holen und zwischenspeichern.
// So sieht OpenLigaDB nie die IP-Adressen der Besucher.
const BVB_TEAM_ID = 7;
const SEASON_TTL_MS = 10 * 60 * 1000;
const SEASON_LIVE_TTL_MS = 60 * 1000;
const LIVE_WINDOW_MS = 2.5 * 60 * 60 * 1000;
const COMPETITIONS = [
  { key: "bl", shortcut: "bl1", name: "Bundesliga" },
  { key: "pokal", shortcut: "dfb", name: "DFB-Pokal" },
  { key: "cl", shortcut: "ucl", name: "Champions League" },
];
const seasonCache = new Map();

const getBundesligaSeason = (date = new Date()) =>
  date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;

const fetchOpenLiga = async (path) => {
  const response = await fetch(`https://api.openligadb.de/${path}`, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`OpenLigaDB ${path}: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
};

const cleanText = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const teamLabel = (team) => cleanText(team?.shortName || team?.teamName || "offen", 40);
const toGoals = (value) => (Number.isInteger(value) && value >= 0 && value < 100 ? value : null);

// Endstand bzw. aktuellen Zwischenstand aus OpenLigaDB-Daten lesen.
const readScore = (match) => {
  const results = Array.isArray(match.matchResults) ? match.matchResults : [];
  const final = [...results].sort((a, b) => (b.resultOrderID ?? 0) - (a.resultOrderID ?? 0))[0];
  const goals = Array.isArray(match.goals) ? match.goals : [];
  const lastGoal = goals[goals.length - 1];
  const source = match.matchIsFinished ? final || lastGoal : lastGoal || final;
  const home = toGoals(source?.pointsTeam1 ?? source?.scoreTeam1);
  const away = toGoals(source?.pointsTeam2 ?? source?.scoreTeam2);
  return home === null || away === null ? null : { home, away };
};

const normalizeMatch = (match, competition, now) => {
  const kickoff = new Date(match.matchDateTimeUTC || match.matchDateTime).getTime();
  if (!Number.isFinite(kickoff)) return null;

  const bvbHome = match.team1?.teamId === BVB_TEAM_ID;
  let score = readScore(match);
  let status = "upcoming";

  if (match.matchIsFinished) status = "finished";
  else if (kickoff <= now && now - kickoff < LIVE_WINDOW_MS) status = "live";
  else if (kickoff <= now) status = "pending";

  if (status === "upcoming") score = null;
  if (status === "live" && !score) score = { home: 0, away: 0 };

  return {
    id: Number(match.matchID) || 0,
    competition: competition.key,
    competitionName: competition.name,
    round: cleanText(match.group?.groupName, 40).replace(/(\d+)\.\s*/, "$1. "),
    kickoff: new Date(kickoff).toISOString(),
    home: teamLabel(match.team1),
    away: teamLabel(match.team2),
    bvbHome,
    venue: cleanText(match.location?.locationCity || match.location?.locationStadium, 60),
    status,
    score,
  };
};

const loadSeason = async (season = getBundesligaSeason()) => {
  const cached = seasonCache.get(season);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.value;

  const [table, ...competitions] = await Promise.allSettled([
    fetchOpenLiga(`getbltable/bl1/${season}`),
    ...COMPETITIONS.map((competition) => fetchOpenLiga(`getmatchdata/${competition.shortcut}/${season}`)),
  ]);

  if (competitions.every((result) => result.status === "rejected")) {
    // Lieber einen etwas älteren Stand zeigen als gar keinen.
    if (cached) return cached.value;
    throw new Error("Spielplan nicht erreichbar");
  }

  const now = Date.now();
  const matches = competitions
    .flatMap((result, index) =>
      result.status === "fulfilled"
        ? result.value
            .filter((match) => match.team1?.teamId === BVB_TEAM_ID || match.team2?.teamId === BVB_TEAM_ID)
            .map((match) => normalizeMatch(match, COMPETITIONS[index], now))
        : []
    )
    .filter(Boolean)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  const tableRows = table.status === "fulfilled" ? table.value : [];
  const bvbIndex = tableRows.findIndex((row) => row.teamInfoId === BVB_TEAM_ID);
  const bvbRow = tableRows[bvbIndex];
  const standing =
    bvbRow && Number(bvbRow.matches) > 0
      ? {
          position: bvbIndex + 1,
          points: Number(bvbRow.points) || 0,
          played: Number(bvbRow.matches) || 0,
        }
      : null;

  const value = {
    season: `${season}/${String(season + 1).slice(2)}`,
    updatedAt: new Date(now).toISOString(),
    incomplete: competitions.some((result) => result.status === "rejected"),
    standing,
    matches,
  };

  const hasLive = matches.some((match) => match.status === "live");
  seasonCache.set(season, { at: now, ttl: hasLive ? SEASON_LIVE_TTL_MS : SEASON_TTL_MS, value });
  return value;
};

// Nächstes Spiel über alle Wettbewerbe. Im Sommer ggf. schon die neue Saison.
const loadNextMatch = async () => {
  const season = getBundesligaSeason();
  const pickNext = (data) =>
    data.matches.find(
      (match) => match.status === "upcoming" || match.status === "live"
    );

  let next = pickNext(await loadSeason(season));
  if (!next) {
    try {
      next = pickNext(await loadSeason(season + 1));
    } catch (error) {
      next = null;
    }
  }

  const value = next
    ? {
        home: next.home,
        away: next.away,
        bvbAtHome: next.bvbHome,
        kickoff: next.kickoff,
        competition: next.competitionName,
        round: next.round,
        venue: next.venue,
      }
    : null;

  return { match: value };
};

// Kalenderdatei (RFC 5545) mit allen Spielen der Saison.
const icsEscape = (value) => String(value).replace(/[\;,]/g, (char) => `\\${char}`).replace(/\r?\n/g, "\\n");
const icsDate = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsFold = (line) => {
  const chunks = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 73) {
    let cut = 73;
    while (Buffer.byteLength(rest.slice(0, cut)) > 73) cut -= 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);
  return chunks.join("\r\n ");
};

const buildSeasonCalendar = (data) => {
  const stamp = icsDate(data.updatedAt);
  const events = data.matches.flatMap((match) => {
    const start = icsDate(match.kickoff);
    const end = icsDate(new Date(new Date(match.kickoff).getTime() + 2 * 60 * 60 * 1000).toISOString());
    const result = match.score && match.status === "finished" ? ` ${match.score.home}:${match.score.away}` : "";
    return [
      "BEGIN:VEVENT",
      `UID:openligadb-${match.id}@bottwartal-borussen`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${icsEscape(`${match.home} – ${match.away}${result}`)}`,
      `DESCRIPTION:${icsEscape([match.competitionName, match.round].filter(Boolean).join(" · "))}`,
      ...(match.venue ? [`LOCATION:${icsEscape(match.venue)}`] : []),
      "END:VEVENT",
    ];
  });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bottwartal Borussen//Spielplan//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`BVB Spielplan ${data.season}`)}`,
    "X-WR-TIMEZONE:Europe/Berlin",
    ...events,
    "END:VCALENDAR",
    "",
  ]
    .map(icsFold)
    .join("\r\n");
};

const requireMember = async (request, response) => {
  const auth = await getSupabaseForRequest(request, response);

  if (!auth.user) {
    sendJson(response, 401, { error: "Nicht eingeloggt" });
    return null;
  }

  return auth;
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
            memberSince: user.created_at,
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

    if (!email || !password || email.length > 254 || password.length > 200) {
      sendJson(response, 400, { error: "Bitte E-Mail und Passwort eingeben." });
      return true;
    }

    if (loginByIpAndEmail.isBlocked(limitKey) || loginByIp.isBlocked(ip) || loginByEmail.isBlocked(email)) {
      log("warn", "Login gesperrt (zu viele Fehlversuche)", { email: maskEmail(email), ip });
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
      loginByIpAndEmail.fail(limitKey);
      loginByIp.fail(ip);
      loginByEmail.fail(email);
      log("warn", "Login abgelehnt", { email: maskEmail(email), ip, reason: error?.message });
      sendJson(response, 401, { error: "E-Mail oder Passwort ist falsch." });
      return true;
    }

    loginByIpAndEmail.clear(limitKey);
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

  if (pathname === "/api/site/season" && request.method === "GET") {
    try {
      sendJson(response, 200, await loadSeason(), { "Cache-Control": "public, max-age=60" });
    } catch (error) {
      log("warn", "Spielplan nicht verfügbar", { error: error.message });
      sendJson(response, 503, { error: "Spielplan gerade nicht erreichbar." });
    }
    return true;
  }

  if (pathname === "/api/site/season.ics" && request.method === "GET") {
    try {
      const data = await loadSeason();
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="bvb-spielplan-${data.season.replace("/", "-")}.ics"`,
        "Cache-Control": "public, max-age=600",
      });
      response.end(buildSeasonCalendar(data));
    } catch (error) {
      log("warn", "Kalender nicht verfügbar", { error: error.message });
      sendJson(response, 503, { error: "Spielplan gerade nicht erreichbar." });
    }
    return true;
  }

  if (pathname === "/api/site/next-match" && request.method === "GET") {
    try {
      sendJson(response, 200, await loadNextMatch(), { "Cache-Control": "public, max-age=300" });
    } catch (error) {
      log("warn", "Nächstes Spiel nicht verfügbar", { error: error.message });
      sendJson(response, 503, { error: "Spielplan gerade nicht erreichbar." });
    }
    return true;
  }

  // Mitgliederliste: nur Anzeigename und Beitrittsdatum, keine E-Mail-Adressen.
  if (pathname === "/api/member/roster" && request.method === "GET") {
    const auth = await requireMember(request, response);
    if (!auth) return true;

    const { data, error } = await auth.supabase
      .from("profiles")
      .select("id, display_name, created_at")
      .order("display_name", { ascending: true });

    if (error) {
      log("error", "Mitgliederliste konnte nicht geladen werden", { error: error.message });
      sendJson(response, 503, { error: "Die Mitgliederliste ist noch nicht eingerichtet." });
      return true;
    }

    sendJson(
      response,
      200,
      data.map((profile) => ({
        name: profile.display_name,
        memberSince: profile.created_at,
        isMe: profile.id === auth.user.id,
      }))
    );
    return true;
  }

  if (pathname === "/api/member/profile" && request.method === "PUT") {
    const auth = await requireMember(request, response);
    if (!auth) return true;

    const body = await readJsonBody(request);
    const displayName = cleanDisplayName(body.displayName);

    if (displayName.length < 2) {
      sendJson(response, 400, { error: "Der Anzeigename braucht mindestens 2 Zeichen." });
      return true;
    }

    const { error } = await auth.supabase.auth.updateUser({ data: { display_name: displayName } });

    if (error) {
      log("error", "Profil konnte nicht gespeichert werden", { error: error.message });
      sendJson(response, 500, { error: "Profil konnte nicht gespeichert werden." });
      return true;
    }

    // Mit der Session des Mitglieds: RLS erlaubt nur die eigenen Zeilen.
    await syncDisplayName(auth.supabase, auth.user.id, displayName);
    log("info", "Profil geändert", { user: auth.user.id.slice(0, 8) });
    sendJson(response, 200, { displayName });
    return true;
  }

  if (pathname === "/api/member/password" && request.method === "PUT") {
    const auth = await requireMember(request, response);
    if (!auth) return true;

    const userKey = auth.user.id;

    if (passwordChangeByUser.isBlocked(userKey)) {
      sendJson(response, 429, { error: "Zu viele Versuche. Bitte warte 15 Minuten." });
      return true;
    }

    const body = await readJsonBody(request);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    const passwordError = validatePassword(newPassword);

    if (passwordError) {
      sendJson(response, 400, { error: passwordError });
      return true;
    }

    if (newPassword === currentPassword) {
      sendJson(response, 400, { error: "Das neue Passwort muss sich vom alten unterscheiden." });
      return true;
    }

    // Altes Passwort bestätigen lassen: Ein offen gelassenes Gerät reicht nicht zum Kontoübernehmen.
    const verifier = createSupabaseClient();
    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: auth.user.email,
      password: currentPassword,
    });

    if (isSupabaseUnavailable(verifyError)) {
      throw httpError(503, SUPABASE_UNAVAILABLE_MESSAGE);
    }

    if (verifyError) {
      passwordChangeByUser.fail(userKey);
      sendJson(response, 400, { error: "Das aktuelle Passwort stimmt nicht." });
      return true;
    }

    const { error } = await auth.supabase.auth.updateUser({ password: newPassword });

    if (error) {
      log("error", "Passwort konnte nicht geändert werden", { error: error.message });
      sendJson(response, 500, { error: "Passwort konnte nicht geändert werden." });
      return true;
    }

    // Alle anderen Geräte abmelden (auch die eben zur Prüfung erzeugte Sitzung).
    const { error: signOutError } = await auth.supabase.auth.signOut({ scope: "others" });

    if (signOutError) {
      log("warn", "Andere Sitzungen konnten nicht beendet werden", { error: signOutError.message });
    }

    passwordChangeByUser.clear(userKey);
    log("info", "Passwort geändert", { user: auth.user.id.slice(0, 8) });
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
  "/404.html",
  "/spielplan.html",
  "/app.css",
  "/scoreboard.js",
  "/spielplan.js",
  "/script.js",
  "/nav.js",
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
    requestedPath = path.posix.normalize(decodeURIComponent(pathname === "/" ? "/index.html" : pathname === "/spielplan" ? "/spielplan.html" : pathname));
  } catch (error) {
    send(response, 400, "Bad request", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  const absolutePath = path.join(ROOT, requestedPath);

  if (!isPublicPath(requestedPath) || !absolutePath.startsWith(ROOT + path.sep)) {
    await sendNotFound(response);
    return;
  }

  if (requestedPath === "/members.html" || requestedPath === "/admin.html") {
    const { user } = await getSupabaseForRequest(request, response);

    if (user && (requestedPath === "/members.html" || isAdminUser(user))) {
      const file = await fs.readFile(absolutePath);
      send(response, 200, file, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return;
    }

    send(response, 302, "", { Location: `/login.html?next=${encodeURIComponent(requestedPath)}` });
    return;
  }

  try {
    const file = await fs.readFile(absolutePath);
    const extension = path.extname(absolutePath);
    const contentType = mimeTypes[extension] || "application/octet-stream";
    // Schriften und Bilder ändern sich praktisch nie; HTML, CSS und JS immer neu prüfen.
    const cacheControl = [".woff2", ".jpeg", ".jpg", ".png", ".svg", ".ico"].includes(extension)
      ? "public, max-age=604800"
      : "no-cache";
    send(response, 200, file, { "Content-Type": contentType, "Cache-Control": cacheControl });
  } catch (error) {
    await sendNotFound(response);
  }
};

const sendNotFound = async (response) => {
  try {
    const page = await fs.readFile(path.join(ROOT, "404.html"));
    send(response, 404, page, { "Content-Type": "text/html; charset=utf-8" });
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
