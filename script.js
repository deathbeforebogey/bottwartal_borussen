const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu-button]");
const nav = document.querySelector("[data-nav]");
const revealItems = document.querySelectorAll(".reveal");
const siteSections = document.querySelector("[data-site-sections]");
const nextMatchElements = {
  home: document.querySelector("[data-next-home]"),
  away: document.querySelector("[data-next-away]"),
  competition: document.querySelector("[data-next-competition]"),
  date: document.querySelector("[data-next-date]"),
  time: document.querySelector("[data-next-time]"),
  countdown: document.querySelector("[data-next-countdown]"),
  source: document.querySelector("[data-next-source]"),
};

const BVB_TEAM_ID = 7;
const OPENLIGADB_BASE_URL = "https://api.openligadb.de";
const KNOWN_BVB_MATCHES = [
  {
    matchDateTime: "2026-08-15T17:30:00+02:00",
    leagueName: "Saisoneröffnung",
    group: { groupName: "Testspiel" },
    team1: { shortName: "BVB" },
    team2: { shortName: "AS Rom" },
    source: "BVB-Spielplan",
  },
  {
    matchDateTime: "2026-08-22T20:30:00+02:00",
    leagueName: "Franz-Beckenbauer-Supercup",
    group: { groupName: "Finale" },
    team1: { shortName: "BVB" },
    team2: { shortName: "FC Bayern" },
    source: "DFL",
  },
];

const updateHeader = () => {
  header.classList.toggle("is-scrolled", window.scrollY > 12);
};

menuButton.addEventListener("click", () => {
  const isOpen = header.classList.toggle("is-open");
  menuButton.setAttribute("aria-label", isOpen ? "Navigation schließen" : "Navigation öffnen");
});

nav.addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    header.classList.remove("is-open");
    menuButton.setAttribute("aria-label", "Navigation öffnen");
  }
});

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16 }
  );

  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

const getBundesligaSeason = (date = new Date()) => {
  const year = date.getFullYear();
  const month = date.getMonth();

  return month >= 6 ? year : year - 1;
};

const formatDate = (date) =>
  new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);

const formatTime = (date) =>
  new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

const formatCountdown = (date) => {
  const diff = date.getTime() - Date.now();

  if (diff <= 0) {
    return "läuft / vorbei";
  }

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);

  if (days > 0) {
    return `${days} Tage ${hours} Std.`;
  }

  return `${hours} Std.`;
};

const getTeamName = (team) => team?.shortName || team?.teamName || "offen";

const getMatchDate = (match) => {
  const dateValue = match.matchDateTime || match.matchDate;
  const date = new Date(dateValue);

  return Number.isNaN(date.getTime()) ? null : date;
};

const renderNextMatch = (match) => {
  const kickoff = getMatchDate(match);
  const homeName = getTeamName(match.team1);
  const awayName = getTeamName(match.team2);

  nextMatchElements.home.textContent = homeName;
  nextMatchElements.away.textContent = awayName;
  nextMatchElements.competition.textContent = `${match.leagueName} · ${match.group?.groupName || "Spieltag"}`;
  nextMatchElements.date.textContent = formatDate(kickoff);
  nextMatchElements.time.textContent = match.matchDateTime ? `${formatTime(kickoff)} Uhr` : "offen";
  nextMatchElements.countdown.textContent = formatCountdown(kickoff);
  nextMatchElements.source.textContent = match.source
    ? `Termin laut ${match.source}; Bundesliga automatisch über OpenLigaDB`
    : "Automatisch aktualisiert über OpenLigaDB";
};

const renderNoMatch = () => {
  nextMatchElements.home.textContent = "BVB";
  nextMatchElements.away.textContent = "wartet";
  nextMatchElements.competition.textContent =
    "Noch kein kommendes Bundesliga-Spiel veröffentlicht";
  nextMatchElements.date.textContent = "offen";
  nextMatchElements.time.textContent = "offen";
  nextMatchElements.countdown.textContent = "Spielplan folgt";
  nextMatchElements.source.textContent =
    "Sobald OpenLigaDB neue BVB-Termine hat, erscheint hier automatisch das nächste Spiel.";
};

const loadNextBvbMatch = async () => {
  const season = getBundesligaSeason();
  const seasonsToCheck = [season, season + 1];

  try {
    const seasonResponses = await Promise.all(
      seasonsToCheck.map((seasonYear) =>
        fetch(`${OPENLIGADB_BASE_URL}/getmatchdata/bl1/${seasonYear}`).then((response) => {
          if (!response.ok) {
            throw new Error(`OpenLigaDB ${seasonYear}: ${response.status}`);
          }

          return response.json();
        }).catch(() => [])
      )
    );

    const now = Date.now();
    const nextMatch = [...seasonResponses.flat(), ...KNOWN_BVB_MATCHES]
      .filter(
        (match) =>
          match.source ||
          match.team1?.teamId === BVB_TEAM_ID ||
          match.team2?.teamId === BVB_TEAM_ID
      )
      .map((match) => ({ ...match, kickoff: getMatchDate(match)?.getTime() }))
      .filter((match) => Number.isFinite(match.kickoff) && match.kickoff > now)
      .sort((a, b) => a.kickoff - b.kickoff)[0];

    if (nextMatch) {
      renderNextMatch(nextMatch);
    } else {
      renderNoMatch();
    }
  } catch (error) {
    renderNoMatch();
    nextMatchElements.source.textContent =
      "Live-Daten gerade nicht erreichbar. Bitte später neu laden.";
  }
};

const loadSiteContent = async () => {
  try {
    const response = await fetch("/api/site/content");

    if (!response.ok) {
      return;
    }

    const content = await response.json();
    document.querySelectorAll("[data-content-key]").forEach((element) => {
      const value = content[element.dataset.contentKey];

      if (value) {
        element.textContent = value;
      }
    });
  } catch (error) {
    // Static fallback text remains visible.
  }
};

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const renderSiteSections = (sections) => {
  if (!siteSections || !sections.length) {
    return;
  }

  siteSections.innerHTML = sections
    .map((section) => {
      const type = ["highlight", "split", "compact"].includes(section.type)
        ? section.type
        : "highlight";
      const button =
        section.button_label && section.button_url
          ? `<a class="button primary" href="${escapeHtml(section.button_url)}">${escapeHtml(section.button_label)}</a>`
          : "";

      return `
        <section class="builder-section builder-${type}">
          <div>
            ${section.eyebrow ? `<p class="eyebrow">${escapeHtml(section.eyebrow)}</p>` : ""}
            <h2>${escapeHtml(section.title)}</h2>
          </div>
          <div>
            <p>${escapeHtml(section.body)}</p>
            ${button}
          </div>
        </section>
      `;
    })
    .join("");
};

const loadSiteSections = async () => {
  try {
    const response = await fetch("/api/site/sections");

    if (!response.ok) {
      return;
    }

    renderSiteSections(await response.json());
  } catch (error) {
    // Static sections remain visible.
  }
};

updateHeader();
loadSiteContent();
loadSiteSections();
loadNextBvbMatch();
window.addEventListener("scroll", updateHeader, { passive: true });
