const siteSections = document.querySelector("[data-site-sections]");
const newsList = document.querySelector("[data-news-list]");

const escapeHtml = (value = "") =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

// Nur Anker, interne Pfade, http(s) und mailto zulassen, keine javascript:-Links.
const isSafeUrl = (url = "") => /^(#|\/(?![/\\])|https?:\/\/|mailto:)/i.test(String(url).trim());

// --- Inhalte aus dem Adminbereich -------------------------------------------------

const loadSiteContent = async () => {
  try {
    const response = await fetch("/api/site/content");
    if (!response.ok) return;

    const content = await response.json();
    document.querySelectorAll("[data-content-key]").forEach((element) => {
      const value = content[element.dataset.contentKey];
      if (value) element.textContent = value;
    });
  } catch (error) {
    // Die eingebauten Standardtexte bleiben stehen.
  }
};

const renderSiteSections = (sections) => {
  if (!siteSections || !sections.length) return;

  siteSections.innerHTML = sections
    .map((section) => {
      const type = ["highlight", "split", "compact"].includes(section.type) ? section.type : "highlight";
      const button =
        section.button_label && section.button_url && isSafeUrl(section.button_url)
          ? `<a class="button ${type === "highlight" ? "button-black" : "button-yellow"}" href="${escapeHtml(
              section.button_url
            )}">${escapeHtml(section.button_label)}</a>`
          : "";

      return `
        <section class="builder builder-${type}">
          <div class="builder-inner">
            <div>
              ${section.eyebrow ? `<p class="builder-tag">${escapeHtml(section.eyebrow)}</p>` : ""}
              <h2>${escapeHtml(section.title)}</h2>
            </div>
            <div>
              ${section.body ? `<p class="lead">${escapeHtml(section.body)}</p>` : ""}
              ${button}
            </div>
          </div>
        </section>`;
    })
    .join("");
};

const loadSiteSections = async () => {
  try {
    const response = await fetch("/api/site/sections");
    if (!response.ok) return;
    renderSiteSections(await response.json());
  } catch (error) {
    // Ohne Blöcke bleibt die Seite vollständig.
  }
};

// --- Meldungen --------------------------------------------------------------------

const formatArticleDate = (value) =>
  new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));

const renderArticles = (articles) => {
  if (!articles.length) {
    newsList.innerHTML =
      '<p class="news-empty">Gerade gibt es keine neuen Meldungen. Schau bald wieder vorbei.</p>';
    return;
  }

  newsList.innerHTML = articles
    .map(
      (article) => `
        <article class="news-item">
          <time datetime="${escapeHtml(article.created_at)}">${formatArticleDate(article.created_at)}</time>
          <div>
            <h3>${escapeHtml(article.title)}</h3>
            <p>${escapeHtml(article.excerpt)}</p>
            ${
              article.body && article.body !== article.excerpt
                ? `<details class="more"><summary>Weiterlesen</summary><p class="article-body">${escapeHtml(
                    article.body
                  )}</p></details>`
                : ""
            }
          </div>
        </article>`
    )
    .join("");
};

const loadArticles = async () => {
  try {
    const response = await fetch("/api/site/articles");
    if (!response.ok) throw new Error();
    renderArticles(await response.json());
  } catch (error) {
    newsList.innerHTML = '<p class="news-empty">Meldungen konnten gerade nicht geladen werden.</p>';
  }
};

loadSiteContent();
loadSiteSections();
loadArticles();
