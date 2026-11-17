// Mitgliederbereich: Ansichten Spieltag, Termine, Mitglieder, Profil.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {
  alert: $("[data-app-alert]"),
  greeting: $("[data-greeting]"),
  greetingSub: $("[data-greeting-sub]"),
  nextTerm: $("[data-next-term]"),
  news: $("[data-news]"),
  terms: $("[data-terms]"),
  openBadge: $("[data-open-badge]"),
  roster: $("[data-roster]"),
  rosterCount: $("[data-roster-count]"),
  rosterSearch: $("[data-roster-search]"),
  myRsvps: $("[data-my-rsvps]"),
  card: $("[data-member-card]"),
  profileForm: $("[data-profile-form]"),
  passwordForm: $("[data-password-form]"),
  toast: $("[data-toast]"),
  adminLink: $("[data-admin-link]"),
};

const RSVP = {
  yes: { label: "Bin dabei", short: "dabei" },
  maybe: { label: "Vielleicht", short: "vielleicht" },
  no: { label: "Kann nicht", short: "abgesagt" },
};

const state = { session: null, terms: [], roster: [] };
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- Hilfsfunktionen --------------------------------------------------------------

const escapeHtml = (value = "") =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const initials = (name = "") =>
  String(name)
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";

const firstName = (name = "") => String(name).replace(/@.*/, "").split(/\s+/)[0];

const berlinToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

const daysUntil = (isoDate) =>
  Math.round((new Date(`${isoDate}T12:00:00Z`) - new Date(`${berlinToday()}T12:00:00Z`)) / 86400000);

const relativeDay = (isoDate) => {
  const days = daysUntil(isoDate);
  if (days <= 0) return "Heute";
  if (days === 1) return "Morgen";
  return `In ${days} Tagen`;
};

const weekday = (isoDate) =>
  new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "UTC" }).format(new Date(`${isoDate}T12:00:00Z`));

const monthYear = (value) =>
  new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(value));

const shortDate = (value) =>
  new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));

const currentSeason = (date = new Date()) => {
  const start = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}/${String(start + 1).slice(2)}`;
};

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const api = async (url, options = {}) => {
  let response;

  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch (error) {
    throw new ApiError("Keine Verbindung zum Server. Bitte prüfe dein Internet.", 0);
  }

  const data = await response.json().catch(() => null);

  if (response.status === 401) {
    window.location.href = "/login.html?next=/members.html";
    throw new ApiError("Bitte melde dich erneut an.", 401);
  }

  if (!response.ok) {
    throw new ApiError(data?.error || "Das hat nicht geklappt. Bitte versuch es noch einmal.", response.status);
  }

  return data;
};

let toastTimer;
const toast = (message) => {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2800);
};

const showAlert = (message) => {
  els.alert.textContent = message;
  els.alert.hidden = !message;
};

// --- Ansichten (Hash-Navigation) --------------------------------------------------

const VIEWS = ["spieltag", "termine", "mitglieder", "profil"];

const showView = (moveFocus) => {
  const requested = window.location.hash.slice(1);
  const view = VIEWS.includes(requested) ? requested : "spieltag";

  $$("[data-view]").forEach((section) => {
    section.hidden = section.dataset.view !== view;
  });
  $$("[data-view-link]").forEach((link) => {
    if (link.dataset.viewLink === view) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  if (moveFocus) {
    window.scrollTo({ top: 0, behavior: "instant" });
    $(`[data-view="${view}"] h1`)?.focus({ preventScroll: true });
  }
};

$$("[data-view] h1").forEach((heading) => heading.setAttribute("tabindex", "-1"));
window.addEventListener("hashchange", () => showView(true));

// --- Termine und Zusagen ----------------------------------------------------------

const countBy = (rsvps) =>
  Object.fromEntries(Object.keys(RSVP).map((status) => [status, rsvps.filter((r) => r.status === status).length]));

const personChip = (rsvp) => `
  <li class="person" data-status="${escapeHtml(rsvp.status)}">
    <span class="avatar${rsvp.isMe ? " is-me" : ""}" aria-hidden="true">${escapeHtml(initials(rsvp.name))}</span>
    <span class="person-text">
      <span class="person-name">${escapeHtml(rsvp.name)}${rsvp.isMe ? " <span class=\"muted\">(du)</span>" : ""}</span>
      ${rsvp.comment ? `<span class="person-note">${escapeHtml(rsvp.comment)}</span>` : ""}
    </span>
  </li>`;

const attendance = (term, compact) => {
  const counts = countBy(term.rsvps);
  const total = term.rsvps.length;

  if (!total) {
    return `<p class="att-empty">Noch keine Antworten. Sei die oder der Erste.</p>`;
  }

  const summary = Object.entries(RSVP)
    .filter(([status]) => counts[status])
    .map(([status, option]) => `<span data-status="${status}"><strong>${counts[status]}</strong> ${option.short}</span>`)
    .join("");

  const bar = `
    <div class="att-bar" aria-hidden="true" data-bar="${counts.yes},${counts.maybe},${counts.no}">
      <span data-status="yes"></span><span data-status="maybe"></span><span data-status="no"></span>
    </div>`;

  if (compact) {
    const yes = term.rsvps.filter((r) => r.status === "yes");
    const stack = yes
      .slice(0, 6)
      .map((r) => `<span class="avatar${r.isMe ? " is-me" : ""}" title="${escapeHtml(r.name)}">${escapeHtml(initials(r.name))}</span>`)
      .join("");
    const more = yes.length > 6 ? `<span class="avatar avatar-more">+${yes.length - 6}</span>` : "";
    return `${bar}<div class="att-row"><p class="att-summary">${summary}</p>${
      yes.length ? `<div class="avatar-stack" aria-label="Dabei: ${escapeHtml(yes.map((r) => r.name).join(", "))}">${stack}${more}</div>` : ""
    }</div>`;
  }

  const going = term.rsvps.filter((r) => r.status !== "no");
  const declined = term.rsvps.filter((r) => r.status === "no");

  return `
    ${bar}
    <p class="att-summary">${summary}</p>
    ${going.length ? `<ul class="people">${going.map(personChip).join("")}</ul>` : ""}
    ${
      declined.length
        ? `<details class="more"><summary>${declined.length} ${declined.length === 1 ? "Absage" : "Absagen"} anzeigen</summary><ul class="people">${declined
            .map(personChip)
            .join("")}</ul></details>`
        : ""
    }`;
};

const rsvpForm = (term, compact) => {
  if (!term.rsvpEnabled) {
    return `<p class="att-empty">Zusagen sind noch nicht eingerichtet.</p>`;
  }

  const mine = term.rsvps.find((r) => r.isMe);
  const buttons = Object.entries(RSVP)
    .map(
      ([status, option]) => `
        <button type="submit" name="status" value="${status}" data-status="${status}" aria-pressed="${mine?.status === status}">
          ${option.label}
        </button>`
    )
    .join("");

  return `
    <form class="rsvp" data-rsvp-form="${escapeHtml(term.id)}">
      <div class="segmented" role="group" aria-label="Deine Antwort zu ${escapeHtml(term.title)}">${buttons}</div>
      ${
        compact
          ? ""
          : `<div class="rsvp-note">
              <label for="note-${escapeHtml(term.id)}">Hinweis für die anderen <span class="muted">(optional)</span></label>
              <div class="inline-field">
                <input id="note-${escapeHtml(term.id)}" name="comment" maxlength="300" autocomplete="off"
                  placeholder="z. B. fahre ab Beilstein, 2 Plätze frei" value="${escapeHtml(mine?.comment || "")}" />
                <button class="button button-small button-ghost-dark" type="submit" name="status" value="comment">Speichern</button>
              </div>
            </div>`
      }
    </form>`;
};

const termCard = (term, { compact = false } = {}) => `
  <article class="term${compact ? " term-compact" : ""}" ${compact ? "" : `id="termin-${escapeHtml(term.id)}"`}>
    <div class="term-date" aria-hidden="true">
      <span class="term-weekday">${escapeHtml(weekday(term.date))}</span>
      <span class="term-day">${escapeHtml(term.day)}</span>
      <span class="term-month">${escapeHtml(term.month)}</span>
    </div>
    <div class="term-body">
      <p class="term-when">
        <span class="pill${daysUntil(term.date) <= 1 ? " pill-hot" : ""}">${relativeDay(term.date)}</span>
        <time datetime="${escapeHtml(term.date)}">${escapeHtml(weekday(term.date))}, ${escapeHtml(term.day)}. ${escapeHtml(term.month)} · ${escapeHtml(term.time)}</time>
      </p>
      <h3>${escapeHtml(term.title)}</h3>
      ${term.description ? `<p class="term-desc">${escapeHtml(term.description)}</p>` : ""}
      ${rsvpForm(term, compact)}
      <div class="attendance">${attendance(term, compact)}</div>
    </div>
  </article>`;

// Balkenbreiten per CSSOM setzen (die CSP erlaubt keine Inline-Styles im HTML).
const sizeBars = (root) => {
  $$("[data-bar]", root).forEach((bar) => {
    const [yes, maybe, no] = bar.dataset.bar.split(",").map(Number);
    const parts = bar.children;
    parts[0].style.flexGrow = yes;
    parts[1].style.flexGrow = maybe;
    parts[2].style.flexGrow = no;
  });
};

const renderTerms = () => {
  const { terms } = state;
  const open = terms.filter((term) => term.rsvpEnabled && !term.rsvps.some((r) => r.isMe)).length;

  els.openBadge.hidden = !open;
  els.openBadge.textContent = open;
  els.openBadge.setAttribute("aria-label", `${open} ohne Antwort`);

  if (!terms.length) {
    const empty = `
      <div class="empty">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.75" y="5.25" width="16.5" height="15" rx="2" /><path d="M3.75 9.75h16.5M8.25 3v4.5M15.75 3v4.5" /></svg>
        <p><strong>Gerade steht nichts an.</strong> Sobald der Vorstand einen Termin einträgt, erscheint er hier.</p>
      </div>`;
    els.terms.innerHTML = empty;
    els.nextTerm.innerHTML = empty;
  } else {
    els.terms.innerHTML = terms.map((term) => termCard(term)).join("");
    els.nextTerm.innerHTML = termCard(terms[0], { compact: true });
  }

  sizeBars(els.terms);
  sizeBars(els.nextTerm);
  renderGreeting();
  renderMyRsvps();
};

const loadTerms = async () => {
  try {
    state.terms = await api("/api/member/terms");
    renderTerms();
  } catch (error) {
    const message = `<p class="error-text">Termine konnten nicht geladen werden. ${escapeHtml(error.message)}</p>`;
    els.terms.innerHTML = message;
    els.nextTerm.innerHTML = message;
  }
};

const setPressed = (eventId, status) => {
  $$(`[data-rsvp-form="${CSS.escape(eventId)}"] .segmented button`).forEach((button) => {
    button.setAttribute("aria-pressed", String(button.value === status));
  });
};

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-rsvp-form]");
  if (!form) return;

  event.preventDefault();
  const eventId = form.dataset.rsvpForm;
  const term = state.terms.find((item) => item.id === eventId);
  const mine = term?.rsvps.find((r) => r.isMe);
  const submitted = event.submitter?.value;
  const status = submitted === "comment" ? mine?.status : submitted;

  if (!status) {
    toast("Wähle zuerst, ob du dabei bist.");
    return;
  }

  // Den Hinweis aus der ausführlichen Ansicht übernehmen, auch wenn in der Kurzansicht geklickt wird.
  const commentField = form.elements.comment || $(`#note-${CSS.escape(eventId)}`);
  const comment = commentField ? commentField.value : mine?.comment || "";
  const previous = mine?.status;
  const buttons = $$(`[data-rsvp-form="${CSS.escape(eventId)}"] button`);

  setPressed(eventId, status);
  buttons.forEach((button) => (button.disabled = true));

  try {
    await api(`/api/member/terms/${encodeURIComponent(eventId)}/rsvp`, {
      method: "PUT",
      body: JSON.stringify({ status, comment }),
    });
    toast(submitted === "comment" ? "Hinweis gespeichert." : `Gespeichert: ${RSVP[status].label}.`);
    await loadTerms();
  } catch (error) {
    setPressed(eventId, previous);
    buttons.forEach((button) => (button.disabled = false));
    toast(error.message);
  }
});

// --- Spieltag ---------------------------------------------------------------------

const renderGreeting = () => {
  if (!state.session) return;

  const name = firstName(state.session.displayName);
  els.greeting.textContent = `Hallo, ${name}!`;

  const next = state.terms[0];
  if (!next) {
    els.greetingSub.textContent = "Gerade stehen keine Fanclub-Termine an.";
    return;
  }

  const mine = next.rsvps.find((r) => r.isMe);
  const lead = `${relativeDay(next.date)}: ${next.title}.`;
  els.greetingSub.textContent = mine
    ? `${lead} Deine Antwort: ${RSVP[mine.status].label}.`
    : `${lead} Du hast noch nicht geantwortet.`;
};

const loadNews = async () => {
  try {
    const articles = await api("/api/site/articles");

    if (!articles.length) {
      els.news.innerHTML = '<p class="muted">Noch keine Meldungen.</p>';
      return;
    }

    els.news.innerHTML = articles
      .slice(0, 4)
      .map(
        (article) => `
          <article class="feed-item">
            <time datetime="${escapeHtml(article.created_at)}">${shortDate(article.created_at)}</time>
            <h3>${escapeHtml(article.title)}</h3>
            <p>${escapeHtml(article.excerpt)}</p>
            ${
              article.body && article.body !== article.excerpt
                ? `<details class="more"><summary>Weiterlesen</summary><p class="article-body">${escapeHtml(article.body)}</p></details>`
                : ""
            }
          </article>`
      )
      .join("");
  } catch (error) {
    els.news.innerHTML = '<p class="error-text">Meldungen konnten nicht geladen werden.</p>';
  }
};

// --- Mitglieder -------------------------------------------------------------------

const renderRoster = () => {
  const query = els.rosterSearch.value.trim().toLowerCase();
  const list = state.roster.filter((member) => member.name.toLowerCase().includes(query));

  els.rosterCount.textContent = `${state.roster.length} ${state.roster.length === 1 ? "Mitglied" : "Mitglieder"} bei den Bottwartal Borussen`;

  if (!list.length) {
    els.roster.innerHTML = `<li class="roster-empty">Niemand mit „${escapeHtml(query)}“ gefunden.</li>`;
    return;
  }

  els.roster.innerHTML = list
    .map(
      (member) => `
        <li class="roster-item${member.isMe ? " is-me" : ""}">
          <span class="avatar avatar-lg${member.isMe ? " is-me" : ""}" aria-hidden="true">${escapeHtml(initials(member.name))}</span>
          <span>
            <strong>${escapeHtml(member.name)}${member.isMe ? ' <span class="muted">(du)</span>' : ""}</strong>
            <span class="muted">dabei seit ${escapeHtml(monthYear(member.memberSince))}</span>
          </span>
        </li>`
    )
    .join("");
};

const loadRoster = async () => {
  try {
    state.roster = await api("/api/member/roster");
    renderRoster();
  } catch (error) {
    els.rosterCount.textContent = "";
    els.roster.innerHTML = `<li class="roster-empty">${escapeHtml(error.message)}</li>`;
  }
};

els.rosterSearch.addEventListener("input", renderRoster);

// --- Profil -----------------------------------------------------------------------

const renderProfile = () => {
  const { session } = state;
  $("[data-card-name]").textContent = session.displayName;
  $("[data-card-since]").textContent = session.memberSince ? monthYear(session.memberSince) : "–";
  $("[data-card-season]").textContent = currentSeason();
  $("[data-card-role]").textContent = session.isAdmin ? "Admin" : "Mitglied";
  $("[data-profile-email]").textContent = session.email;
  els.profileForm.elements.displayName.value = session.displayName;
};

const renderMyRsvps = () => {
  const mine = state.terms
    .map((term) => ({ term, rsvp: term.rsvps.find((r) => r.isMe) }))
    .filter((item) => item.rsvp);

  els.myRsvps.innerHTML = mine.length
    ? mine
        .map(
          ({ term, rsvp }) => `
            <li>
              <a href="#termine" data-jump="${escapeHtml(term.id)}">
                <span><strong>${escapeHtml(term.title)}</strong><span class="muted">${escapeHtml(term.day)}. ${escapeHtml(term.month)} · ${escapeHtml(term.time)}</span></span>
                <span class="status-chip" data-status="${escapeHtml(rsvp.status)}">${RSVP[rsvp.status].short}</span>
              </a>
            </li>`
        )
        .join("")
    : '<li class="muted">Du hast noch auf keinen Termin geantwortet.</li>';
};

// Sprung von "Deine Zusagen" direkt zum Termin.
els.myRsvps.addEventListener("click", (event) => {
  const link = event.target.closest("[data-jump]");
  if (!link) return;
  window.setTimeout(() => {
    const target = document.getElementById(`termin-${link.dataset.jump}`);
    target?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    target?.classList.add("is-highlighted");
    window.setTimeout(() => target?.classList.remove("is-highlighted"), 1600);
  }, 50);
});

const formMessage = (form, message, isError) => {
  const node = $("[data-form-message]", form);
  node.textContent = message;
  node.classList.toggle("is-error", Boolean(isError));
};

const withBusy = async (form, action) => {
  const button = $("button[type=submit]", form);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await action();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
};

els.profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const displayName = els.profileForm.elements.displayName.value.trim();

  if (displayName.length < 2) {
    formMessage(els.profileForm, "Der Name braucht mindestens 2 Zeichen.", true);
    els.profileForm.elements.displayName.focus();
    return;
  }

  withBusy(els.profileForm, async () => {
    try {
      const result = await api("/api/member/profile", { method: "PUT", body: JSON.stringify({ displayName }) });
      state.session.displayName = result.displayName;
      formMessage(els.profileForm, "");
      renderProfile();
      renderGreeting();
      toast("Name gespeichert.");
      loadRoster();
      loadTerms();
    } catch (error) {
      formMessage(els.profileForm, error.message, true);
    }
  });
});

els.passwordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = els.passwordForm;
  const { currentPassword, newPassword, confirmPassword } = form.elements;

  if (!currentPassword.value) {
    formMessage(form, "Bitte gib dein aktuelles Passwort ein.", true);
    currentPassword.focus();
    return;
  }

  if (newPassword.value.length < 10) {
    formMessage(form, "Das neue Passwort braucht mindestens 10 Zeichen.", true);
    newPassword.focus();
    return;
  }

  if (newPassword.value !== confirmPassword.value) {
    formMessage(form, "Die beiden neuen Passwörter stimmen nicht überein.", true);
    confirmPassword.focus();
    return;
  }

  withBusy(form, async () => {
    try {
      await api("/api/member/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }),
      });
      form.reset();
      formMessage(form, "");
      toast("Passwort geändert. Andere Geräte wurden abgemeldet.");
    } catch (error) {
      formMessage(form, error.message, true);
    }
  });
});

$$("[data-reveal]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.reveal);
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", visible ? "Passwort verbergen" : "Passwort anzeigen");
  });
});

// Ausweis neigt sich leicht zum Zeiger (nur mit Maus und ohne reduzierte Bewegung).
if (!reduceMotion && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  els.card.addEventListener("pointermove", (event) => {
    const rect = els.card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    els.card.style.setProperty("--tilt-x", `${(-y * 8).toFixed(2)}deg`);
    els.card.style.setProperty("--tilt-y", `${(x * 10).toFixed(2)}deg`);
    els.card.style.setProperty("--glare-x", `${((x + 0.5) * 100).toFixed(1)}%`);
  });
  els.card.addEventListener("pointerleave", () => {
    els.card.style.setProperty("--tilt-x", "0deg");
    els.card.style.setProperty("--tilt-y", "0deg");
  });
}

// --- Start ------------------------------------------------------------------------

$("[data-logout]").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  window.location.href = "/";
});

const init = async () => {
  showView(false);

  try {
    const session = await api("/api/session");

    if (!session.authenticated) {
      window.location.href = "/login.html?next=/members.html";
      return;
    }

    state.session = session.user;
  } catch (error) {
    showAlert(error.status === 503 ? error.message : `Der Mitgliederbereich ist gerade nicht erreichbar. ${error.message}`);
    return;
  }

  els.adminLink.hidden = !state.session.isAdmin;
  renderProfile();
  renderGreeting();
  await Promise.all([loadTerms(), loadNews(), loadRoster()]);
};

init();
