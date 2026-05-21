const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { loadEnvFile } = require("./utils/env");
const {
  createSupabaseAdminClient,
  createSupabaseClient,
  createSupabaseClientForSession,
} = require("./utils/supabase-node");

loadEnvFile();

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const ACCESS_COOKIE = "bwb_sb_access";
const REFRESH_COOKIE = "bwb_sb_refresh";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

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

const send = (response, status, body, headers = {}) => {
  response.writeHead(status, headers);
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

const readJsonBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

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

  const supabase = await createSupabaseClientForSession(accessToken, refreshToken);
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    clearAuthCookies(response);
    return { supabase, user: null };
  }

  return { supabase, user: data.user };
};

const isAdminUser = (user) =>
  user?.app_metadata?.role === "admin" ||
  user?.app_metadata?.is_admin === true ||
  user?.user_metadata?.role === "admin" ||
  user?.user_metadata?.is_admin === true;

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

const handleAdminApi = async (request, response, pathname) => {
  if (!pathname.startsWith("/api/admin/")) {
    return false;
  }

  const adminAuth = await requireAdmin(request, response);

  if (!adminAuth) {
    return true;
  }

  const { admin } = adminAuth;

  if (pathname === "/api/admin/content" && request.method === "GET") {
    const { data, error } = await admin
      .from("site_content")
      .select("key, label, value")
      .order("key");

    if (error) {
      sendJson(response, 500, { error: error.message });
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
      sendJson(response, 500, { error: error.message });
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
      sendJson(response, 500, { error: error.message });
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
      sendJson(response, 500, { error: error.message });
      return true;
    }

    sendJson(response, 200, data);
    return true;
  }

  if (pathname.startsWith("/api/admin/sections/") && request.method === "DELETE") {
    const id = pathname.slice("/api/admin/sections/".length);
    const { error } = await admin.from("site_sections").delete().eq("id", id);

    if (error) {
      sendJson(response, 500, { error: error.message });
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
      sendJson(response, 500, { error: error.message });
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
      sendJson(response, 500, { error: error.message });
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
      sendJson(response, 500, { error: error.message });
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
      sendJson(response, 500, { error: error.message });
      return true;
    }

    sendJson(response, 200, data);
    return true;
  }

  if (pathname.startsWith("/api/admin/articles/") && request.method === "DELETE") {
    const id = pathname.slice("/api/admin/articles/".length);
    const { error } = await admin.from("articles").delete().eq("id", id);

    if (error) {
      sendJson(response, 500, { error: error.message });
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
      sendJson(response, 500, { error: error.message });
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
      sendJson(response, 500, { error: error.message });
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
      sendJson(response, 500, { error: error.message });
      return true;
    }

    sendJson(response, 200, data);
    return true;
  }

  if (pathname.startsWith("/api/admin/events/") && request.method === "DELETE") {
    const id = pathname.slice("/api/admin/events/".length);
    const { error } = await admin.from("member_events").delete().eq("id", id);

    if (error) {
      sendJson(response, 500, { error: error.message });
      return true;
    }

    sendJson(response, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/admin/users" && request.method === "GET") {
    const { data, error } = await admin.auth.admin.listUsers();

    if (error) {
      sendJson(response, 500, { error: error.message });
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
        role: user.app_metadata?.role || user.user_metadata?.role || "member",
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
      sendJson(response, 500, { error: error.message });
      return true;
    }

    sendJson(response, 201, { id: data.user.id, email: data.user.email });
    return true;
  }

  if (pathname.startsWith("/api/admin/users/") && request.method === "PUT") {
    const body = await readJsonBody(request);
    const id = getBodyId(body, pathname, "/api/admin/users");
    const { data: existingUserData, error: getUserError } = await admin.auth.admin.getUserById(id);

    if (getUserError || !existingUserData.user) {
      sendJson(response, 404, { error: "Mitglied nicht gefunden." });
      return true;
    }

    const existingUser = existingUserData.user;
    const updates = {};

    if (body.email) updates.email = body.email;
    if (body.password) updates.password = body.password;
    if (body.role) updates.app_metadata = { ...(existingUser.app_metadata || {}), role: body.role };
    if (Object.prototype.hasOwnProperty.call(body, "displayName")) {
      updates.user_metadata = {
        ...(existingUser.user_metadata || {}),
        display_name: String(body.displayName || "").trim() || body.email || existingUser.email,
      };
    }

    const { data, error } = await admin.auth.admin.updateUserById(id, updates);

    if (error) {
      sendJson(response, 500, { error: error.message });
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
    const { error } = await admin.auth.admin.deleteUser(id);

    if (error) {
      sendJson(response, 500, { error: error.message });
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

    if (error) {
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
      sendJson(response, 200, []);
      return true;
    }

    sendJson(response, 200, data);
    return true;
  }

  if (pathname === "/api/login" && request.method === "POST") {
    const body = await readJsonBody(request);
    const email = String(body.email || body.username || "").trim();
    const password = String(body.password || "");
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      sendJson(response, 401, { error: "Ungültige Login-Daten" });
      return true;
    }

    setAuthCookies(response, data.session);
    sendJson(response, 200, { authenticated: true });
    return true;
  }

  if (pathname === "/api/logout" && request.method === "POST") {
    const { supabase } = await getSupabaseForRequest(request, response);
    await supabase.auth.signOut();
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

    const { data, error } = await supabase
      .from("member_events")
      .select("event_date, day, month, event_time, title, description")
      .order("event_date", { ascending: true });

    if (error) {
      sendJson(response, 500, { error: "Termine konnten nicht geladen werden." });
      return true;
    }

    sendJson(
      response,
      200,
      data.map((event) => ({
        date: event.event_date,
        day: event.day,
        month: event.month,
        time: event.event_time,
        title: event.title,
        description: event.description,
      })),
      { "Cache-Control": "no-store" }
    );
    return true;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "API-Endpunkt nicht gefunden" });
    return true;
  }

  return false;
};

const serveStatic = async (request, response, pathname) => {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const absolutePath = path.normalize(path.join(ROOT, decodeURIComponent(requestedPath)));

  if (!absolutePath.startsWith(ROOT) || absolutePath.includes(`${path.sep}data${path.sep}`)) {
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

    send(response, 302, "", { Location: "/login.html" });
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

const server = http.createServer(async (request, response) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  try {
    const handled = await handleApi(request, response, pathname);

    if (!handled) {
      await serveStatic(request, response, pathname);
    }
  } catch (error) {
    sendJson(response, 500, { error: "Serverfehler" });
  }
});

server.listen(PORT, () => {
  console.log(`Bottwartal Borussen läuft auf http://127.0.0.1:${PORT}`);
});
