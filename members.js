const welcome = document.querySelector("[data-member-welcome]");
const termsContainer = document.querySelector("[data-member-terms]");
const termsStatus = document.querySelector("[data-member-terms-status]");
const logoutButton = document.querySelector("[data-logout]");
const adminLink = document.querySelector("[data-admin-link]");

const escapeHtml = (value = "") =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

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
          </div>
        </article>
      `
    )
    .join("");
};

const loadMembersArea = async () => {
  let session;

  try {
    const sessionResponse = await fetch("/api/session", { credentials: "same-origin" });
    session = await sessionResponse.json();
  } catch (error) {
    welcome.textContent = "Session konnte nicht geladen werden.";
    termsStatus.textContent = "";
    return;
  }

  if (!session.authenticated) {
    window.location.href = "/login.html";
    return;
  }

  welcome.textContent = `Willkommen, ${session.user.displayName || session.user.email}.`;
  adminLink.hidden = !session.user.isAdmin;

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

logoutButton.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  window.location.href = "/";
});

loadMembersArea();
