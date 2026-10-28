const welcome = document.querySelector("[data-member-welcome]");
const termsContainer = document.querySelector("[data-member-terms]");
const termsStatus = document.querySelector("[data-member-terms-status]");
const newsContainer = document.querySelector("[data-member-news]");
const newsStatus = document.querySelector("[data-member-news-status]");
const logoutButton = document.querySelector("[data-logout]");
const adminLink = document.querySelector("[data-admin-link]");

const RSVP_OPTIONS = [
  { status: "yes", label: "Bin dabei", summary: "dabei" },
  { status: "maybe", label: "Vielleicht", summary: "vielleicht" },
  { status: "no", label: "Kann nicht", summary: "abgesagt" },
];

const escapeHtml = (value = "") =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatArticleDate = (value) =>
  new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));

const renderRsvp = (term) => {
  if (!term.rsvpEnabled) {
    return "";
  }

  const mine = term.rsvps.find((rsvp) => rsvp.isMe);
  const summary = RSVP_OPTIONS.map((option) => {
    const count = term.rsvps.filter((rsvp) => rsvp.status === option.status).length;
    return count ? `${count} ${option.summary}` : "";
  })
    .filter(Boolean)
    .join(" · ");

  const people = term.rsvps
    .map((rsvp) => {
      const option = RSVP_OPTIONS.find((item) => item.status === rsvp.status);
      const comment = rsvp.comment ? ` – ${escapeHtml(rsvp.comment)}` : "";
      return `<li><strong>${escapeHtml(rsvp.name)}</strong> <span>(${option.summary})</span>${comment}</li>`;
    })
    .join("");

  return `
    <form class="rsvp" data-rsvp-form="${escapeHtml(term.id)}">
      <div class="rsvp-buttons" role="group" aria-label="Deine Antwort zu ${escapeHtml(term.title)}">
        ${RSVP_OPTIONS.map(
          (option) => `
            <button type="submit" name="status" value="${option.status}" aria-pressed="${mine?.status === option.status}">
              ${option.label}
            </button>
          `
        ).join("")}
      </div>
      <label class="rsvp-comment">
        Kommentar (optional)
        <input name="comment" maxlength="300" placeholder="z. B. fahre selbst, 2 Plätze frei" value="${escapeHtml(mine?.comment || "")}" />
      </label>
      <p class="rsvp-message" data-rsvp-message role="status" aria-live="polite"></p>
      ${
        term.rsvps.length
          ? `<details class="rsvp-people">
              <summary>${summary}</summary>
              <ul>${people}</ul>
            </details>`
          : `<p class="rsvp-empty">Noch keine Antworten.</p>`
      }
    </form>
  `;
};

const renderTerms = (terms) => {
  if (!terms.length) {
    termsContainer.innerHTML = "";
    termsStatus.textContent = "Aktuell sind keine internen Termine eingetragen.";
    return;
  }

  termsStatus.textContent = "";
  termsContainer.innerHTML = terms
    .map(
      (term) => `
        <article class="schedule-item">
          <time datetime="${escapeHtml(term.date)}">
            <span>${escapeHtml(term.day)}</span>
            ${escapeHtml(term.month)}
          </time>
          <div>
            <p>${escapeHtml(term.time)}</p>
            <h3>${escapeHtml(term.title)}</h3>
            <span>${escapeHtml(term.description)}</span>
            ${renderRsvp(term)}
          </div>
        </article>
      `
    )
    .join("");
};

const loadTerms = async () => {
  try {
    const termsResponse = await fetch("/api/member/terms", { credentials: "same-origin" });

    if (!termsResponse.ok) {
      throw new Error("Termine konnten nicht geladen werden.");
    }

    renderTerms(await termsResponse.json());
  } catch (error) {
    termsContainer.innerHTML = "";
    termsStatus.textContent =
      "Termine konnten nicht geladen werden. Bitte prüfen, ob die Supabase-Tabellen angelegt sind.";
  }
};

const renderNews = (articles) => {
  if (!articles.length) {
    newsContainer.innerHTML = "";
    newsStatus.textContent = "Noch keine Meldungen.";
    return;
  }

  newsStatus.textContent = "";
  newsContainer.innerHTML = articles
    .map(
      (article) => `
        <article class="member-news-item">
          <time datetime="${escapeHtml(article.created_at)}">${formatArticleDate(article.created_at)}</time>
          <h3>${escapeHtml(article.title)}</h3>
          <p>${escapeHtml(article.excerpt)}</p>
          ${
            article.body && article.body !== article.excerpt
              ? `<details><summary>Weiterlesen</summary><p class="article-body">${escapeHtml(article.body)}</p></details>`
              : ""
          }
        </article>
      `
    )
    .join("");
};

const loadNews = async () => {
  try {
    const response = await fetch("/api/site/articles");

    if (!response.ok) {
      throw new Error();
    }

    renderNews(await response.json());
  } catch (error) {
    newsStatus.textContent = "Meldungen konnten nicht geladen werden.";
  }
};

termsContainer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target.closest("[data-rsvp-form]");
  const status = event.submitter?.value;

  if (!form || !status) {
    return;
  }

  const message = form.querySelector("[data-rsvp-message]");
  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => (button.disabled = true));
  message.textContent = "Wird gespeichert …";

  try {
    const response = await fetch(`/api/member/terms/${encodeURIComponent(form.dataset.rsvpForm)}/rsvp`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ status, comment: form.elements.comment.value }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "Antwort konnte nicht gespeichert werden.");
    }

    await loadTerms();
  } catch (error) {
    message.textContent = error.message;
    buttons.forEach((button) => (button.disabled = false));
  }
});

const loadMembersArea = async () => {
  let session;

  try {
    const sessionResponse = await fetch("/api/session", { credentials: "same-origin" });
    session = await sessionResponse.json();

    if (!sessionResponse.ok) {
      throw new Error(session.error);
    }
  } catch (error) {
    // Netzwerkfehler (TypeError) haben englische Browser-Meldungen, daher eigener Text.
    welcome.textContent =
      error instanceof TypeError || !error.message
        ? "Server nicht erreichbar. Bitte später erneut versuchen."
        : error.message;
    termsStatus.textContent = "";
    newsStatus.textContent = "";
    return;
  }

  if (!session.authenticated) {
    window.location.href = "/login.html";
    return;
  }

  welcome.textContent = `Willkommen, ${session.user.displayName || session.user.email}.`;
  adminLink.hidden = !session.user.isAdmin;

  await Promise.all([loadTerms(), loadNews()]);
};

logoutButton.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

loadMembersArea();
