// Prüft, ob Website und Datenbank vollständig funktionieren: npm run check
//
// 1. Konfiguration und Erreichbarkeit von Supabase
// 2. Alle Tabellen vorhanden, mindestens ein Admin
// 3. Echter Durchlauf über den Server: Login, Termine, Zusage speichern,
//    Admin-Änderung mit Protokolleintrag, Schutz gegen fremde Schreibzugriffe
//
// Für Schritt 3 werden ein Test-Mitglied, ein Test-Admin, ein Test-Termin und ein
// Test-Artikel angelegt und am Ende wieder gelöscht.

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const { loadEnvFile } = require("../utils/env");
const { createSupabaseAdminClient, createSupabaseClient } = require("../utils/supabase-node");

loadEnvFile();

const ROOT = path.join(__dirname, "..");
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TABLES = ["member_events", "site_content", "articles", "site_sections", "event_rsvps", "admin_audit_log"];

let failures = 0;
const ok = (message) => console.log(`  ✔ ${message}`);
const fail = (message, detail) => {
  failures += 1;
  console.log(`  ✘ ${message}${detail ? `\n      ${detail}` : ""}`);
};
const check = (condition, message, detail) => (condition ? ok(message) : fail(message, detail));

// Kleiner HTTP-Client, der die Login-Cookies wie ein Browser mitschickt.
const createBrowser = () => {
  const cookies = new Map();

  return async (pathname, { method = "GET", body } = {}) => {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      redirect: "manual",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        Origin: BASE_URL,
        Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    response.headers.getSetCookie().forEach((cookie) => {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    });

    const text = await response.text();
    let data = text;

    try {
      data = JSON.parse(text);
    } catch (error) {
      // HTML oder Text
    }

    return { status: response.status, data };
  };
};

const startServer = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    const timer = setTimeout(() => reject(new Error(`Server startet nicht:\n${output.join("")}`)), 10000);

    const onData = (chunk) => {
      output.push(chunk.toString());
      if (chunk.toString().includes("läuft auf")) {
        clearTimeout(timer);
        resolve({ child, output });
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`Server beendet (Code ${code}):\n${output.join("")}`)));
  });

const checkConfiguration = async (admin) => {
  console.log("\n1. Konfiguration");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  check(Boolean(url), "NEXT_PUBLIC_SUPABASE_URL gesetzt");
  check(Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY), "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY gesetzt");
  check(Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), "SUPABASE_SERVICE_ROLE_KEY gesetzt");

  if (!url || !admin) {
    return false;
  }

  try {
    await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(8000) });
    ok(`Supabase erreichbar (${new URL(url).host})`);
    return true;
  } catch (error) {
    fail(
      `Supabase nicht erreichbar (${new URL(url).host})`,
      `${error.cause?.code || error.message}. Projekt im Supabase-Dashboard prüfen (pausiert/gelöscht?) und URL in .env.local vergleichen.`
    );
    return false;
  }
};

const checkDatabase = async (admin) => {
  console.log("\n2. Datenbank");
  let allTables = true;

  for (const table of TABLES) {
    const { error } = await admin.from(table).select("*", { head: true, count: "exact" });
    check(!error, `Tabelle ${table}`, error && `${error.message} → supabase/setup.sql im SQL Editor ausführen`);
    allTables &&= !error;
  }

  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });

  if (error) {
    fail("Nutzer konnten nicht gelesen werden", error.message);
    return allTables;
  }

  const admins = data.users.filter((user) => user.app_metadata?.role === "admin");
  check(admins.length > 0, `${data.users.length} Nutzer, davon ${admins.length} Admin(s)`, "Kein Admin → npm run make-first-user-admin");

  const { data: signupSettings } = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
  })
    .then(async (response) => ({ data: await response.json() }))
    .catch(() => ({ data: null }));

  if (signupSettings) {
    check(
      signupSettings.disable_signup === true,
      "Öffentliche Registrierung ist ausgeschaltet",
      "Supabase → Authentication → Sign In / Providers → 'Allow new users to sign up' ausschalten"
    );
  }

  return allTables;
};

const runEndToEnd = async (admin) => {
  console.log("\n3. Durchlauf über den Server");
  const suffix = crypto.randomBytes(4).toString("hex");
  const password = crypto.randomBytes(18).toString("base64url");
  const created = { users: [], eventId: null, articleId: null };
  let server;

  try {
    server = await startServer();
    ok(`Server gestartet (Port ${PORT})`);

    const health = await createBrowser()("/api/health");
    check(health.status === 200 && health.data.ok, "Health-Check meldet Datenbank erreichbar", JSON.stringify(health.data));

    const leak = await createBrowser()("/.env.local");
    check(leak.status === 404, ".env.local ist nicht abrufbar");

    // Testnutzer anlegen
    const makeUser = async (role) => {
      const email = `check-${role}-${suffix}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: `Test ${role} ${suffix}` },
        app_metadata: { role },
      });
      if (error) throw new Error(`Testnutzer anlegen: ${error.message}`);
      created.users.push(data.user.id);
      return { email, id: data.user.id };
    };

    const member = await makeUser("member");
    const adminUser = await makeUser("admin");
    ok("Test-Mitglied und Test-Admin angelegt");

    // Test-Termin in der Zukunft
    const eventDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const { data: event, error: eventError } = await admin
      .from("member_events")
      .insert({ event_date: eventDate, day: eventDate.slice(8), month: "Test", event_time: "19:09 Uhr", title: `[Test] ${suffix}`, description: "Automatischer Test" })
      .select()
      .single();
    if (eventError) throw new Error(`Test-Termin anlegen: ${eventError.message}`);
    created.eventId = event.id;

    // Mitglied: Login, Session, Termine, Zusage
    const memberBrowser = createBrowser();
    const wrongLogin = await memberBrowser("/api/login", { method: "POST", body: { email: member.email, password: "falsch" } });
    check(wrongLogin.status === 401, "Falsches Passwort wird abgelehnt");

    const login = await memberBrowser("/api/login", { method: "POST", body: { email: member.email, password } });
    check(login.status === 200, "Mitglied kann sich einloggen", JSON.stringify(login.data));

    const session = await memberBrowser("/api/session");
    check(session.data.authenticated && !session.data.user.isAdmin, "Session erkannt, keine Admin-Rechte");

    const membersPage = await memberBrowser("/members.html");
    check(membersPage.status === 200, "Mitgliederbereich öffnet sich");

    const adminPageAsMember = await memberBrowser("/admin.html");
    check(adminPageAsMember.status === 302, "Adminbereich bleibt für Mitglieder gesperrt");

    const adminApiAsMember = await memberBrowser("/api/admin/users");
    check(adminApiAsMember.status === 403, "Admin-API lehnt Mitglieder ab");

    const terms = await memberBrowser("/api/member/terms");
    const testTerm = Array.isArray(terms.data) && terms.data.find((term) => term.id === event.id);
    check(Boolean(testTerm), "Test-Termin erscheint im Mitgliederbereich");
    check(testTerm?.rsvpEnabled, "Zusagen sind aktiviert");

    const rsvp = await memberBrowser(`/api/member/terms/${event.id}/rsvp`, {
      method: "PUT",
      body: { status: "yes", comment: "Test-Kommentar" },
    });
    check(rsvp.status === 200, "Zusage wird gespeichert", JSON.stringify(rsvp.data));

    const change = await memberBrowser(`/api/member/terms/${event.id}/rsvp`, { method: "PUT", body: { status: "maybe" } });
    const afterChange = await memberBrowser("/api/member/terms");
    const myRsvp = afterChange.data.find((term) => term.id === event.id)?.rsvps.find((item) => item.isMe);
    check(change.status === 200 && myRsvp?.status === "maybe", "Zusage lässt sich ändern und wird angezeigt");

    // Schutz: fremde Schreibzugriffe
    const anon = createSupabaseClient();
    const { error: anonInsert } = await anon.from("member_events").insert({ event_date: eventDate, day: "1", month: "x", event_time: "x", title: "hack", description: "x" });
    check(Boolean(anonInsert), "Anonym kann keine Termine anlegen");

    const { data: anonEvents } = await anon.from("member_events").select("id");
    check(!anonEvents?.length, "Anonym kann keine internen Termine lesen");

    const memberClient = createSupabaseClient();
    await memberClient.auth.signInWithPassword({ email: member.email, password });
    const { error: foreignRsvp } = await memberClient
      .from("event_rsvps")
      .insert({ event_id: event.id, user_id: adminUser.id, display_name: "Fake", status: "no" });
    check(Boolean(foreignRsvp), "Mitglied kann nicht im Namen anderer zusagen");
    const { error: memberEventInsert } = await memberClient.from("articles").insert({ title: "hack", excerpt: "x", body: "x" });
    check(Boolean(memberEventInsert), "Mitglied kann keine Artikel anlegen");
    await memberClient.auth.signOut();

    const foreignOrigin = await fetch(`${BASE_URL}/api/logout`, { method: "POST", headers: { Origin: "https://evil.example" } });
    check(foreignOrigin.status === 403, "Anfragen von fremden Seiten werden abgelehnt");

    // Admin: Artikel anlegen, Protokoll prüfen, löschen
    const adminBrowser = createBrowser();
    const adminLogin = await adminBrowser("/api/login", { method: "POST", body: { email: adminUser.email, password } });
    check(adminLogin.status === 200, "Admin kann sich einloggen");

    const adminPage = await adminBrowser("/admin.html");
    check(adminPage.status === 200, "Adminbereich öffnet sich");

    const article = await adminBrowser("/api/admin/articles", {
      method: "POST",
      body: { title: `[Test] Artikel ${suffix}`, excerpt: "Test", body: "Test", published: false },
    });
    created.articleId = article.data?.id;
    check(article.status === 201, "Admin kann Artikel speichern", JSON.stringify(article.data));

    const audit = await adminBrowser("/api/admin/audit");
    const auditEntry = Array.isArray(audit.data) && audit.data.find((entry) => entry.target_label === `[Test] Artikel ${suffix}`);
    check(Boolean(auditEntry), "Änderung steht im Protokoll", JSON.stringify(audit.data).slice(0, 200));

    if (created.articleId) {
      const deleted = await adminBrowser(`/api/admin/articles/${created.articleId}`, { method: "DELETE" });
      check(deleted.status === 200, "Admin kann Artikel löschen");
      if (deleted.status === 200) created.articleId = null;
    }

    const selfDelete = await adminBrowser(`/api/admin/users/${adminUser.id}`, { method: "DELETE" });
    check(selfDelete.status === 400, "Admin kann sich nicht selbst löschen");

    const logout = await memberBrowser("/api/logout", { method: "POST" });
    const afterLogout = await memberBrowser("/api/session");
    check(logout.status === 200 && !afterLogout.data.authenticated, "Logout funktioniert");

    const logLines = server.output.join("");
    check(/INFO POST \/api\/login status=200/.test(logLines), "Server schreibt Logs");
    check(!logLines.includes(password), "Passwörter erscheinen nicht im Log");
  } catch (error) {
    fail("Durchlauf abgebrochen", error.message);
  } finally {
    console.log("\n4. Aufräumen");
    if (created.articleId) await admin.from("articles").delete().eq("id", created.articleId);
    if (created.eventId) await admin.from("member_events").delete().eq("id", created.eventId);
    await admin.from("admin_audit_log").delete().like("target_label", `%${suffix}%`);
    for (const id of created.users) {
      await admin.from("admin_audit_log").delete().eq("actor_id", id);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) fail(`Testnutzer ${id} konnte nicht gelöscht werden`, error.message);
    }
    ok("Testdaten entfernt");
    server?.child.kill();
  }
};

const run = async () => {
  const admin = createSupabaseAdminClient();
  const reachable = await checkConfiguration(admin);

  if (reachable) {
    const tablesReady = await checkDatabase(admin);

    if (tablesReady && !process.argv.includes("--quick")) {
      await runEndToEnd(admin);
    }
  }

  console.log(failures ? `\n✘ ${failures} Problem(e) gefunden.\n` : "\n✔ Alles funktioniert.\n");
  process.exit(failures ? 1 : 0);
};

run();
