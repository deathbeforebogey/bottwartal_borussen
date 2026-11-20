// Spielplan: alle BVB-Spiele der Saison. Daten kommen vom eigenen Server
// (/api/site/season), der OpenLigaDB abfragt – der Browser spricht nie mit Dritten.
(() => {
  // --- Hilfen ---------------------------------------------------------------------

  const TZ = "Europe/Berlin";
  const OUTCOME_LABEL = { w: "Sieg", d: "Remis", l: "Niederlage" };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const escapeHtml = (value = "") =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const fmt = (options) => new Intl.DateTimeFormat("de-DE", { timeZone: TZ, ...options });
  const fmtWeekday = fmt({ weekday: "short" });
  const fmtDay = fmt({ day: "2-digit", month: "2-digit" });
  const fmtTime = fmt({ hour: "2-digit", minute: "2-digit" });
  const fmtMonth = fmt({ month: "long", year: "numeric" });
  const fmtLong = fmt({ weekday: "long", day: "numeric", month: "long" });
  const fmtKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

  const dayNumber = (date) => {
    const [y, m, d] = fmtKey.format(date).split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };

  const relativeDay = (date) => {
    const diff = dayNumber(date) - dayNumber(new Date());
    if (diff <= 0) return "Heute";
    if (diff === 1) return "Morgen";
    return `In ${diff} Tagen`;
  };

  const bvbName = "BVB";
  const homeName = (match) => (match.bvbHome ? bvbName : match.home);
  const awayName = (match) => (match.bvbHome ? match.away : bvbName);
  const opponent = (match) => (match.bvbHome ? match.away : match.home);

  const outcomeOf = (match) => {
    if (!match.score || (match.status !== "finished" && match.status !== "live")) return null;
    const own = match.bvbHome ? match.score.home : match.score.away;
    const other = match.bvbHome ? match.score.away : match.score.home;
    return own > other ? "w" : own < other ? "l" : "d";
  };

  const goalDiff = (match) => {
    const own = match.bvbHome ? match.score.home : match.score.away;
    const other = match.bvbHome ? match.score.away : match.score.home;
    return own - other;
  };

  // --- Zustand --------------------------------------------------------------------

  const els = {
    seasonLabel: document.querySelector("[data-season-label]"),
    pulse: document.querySelector("[data-pulse]"),
    pulseScroll: document.querySelector("[data-pulse-scroll]"),
    fixtures: document.querySelector("[data-fixtures]"),
    note: document.querySelector("[data-fixtures-note]"),
    jumpNext: document.querySelector("[data-jump-next]"),
    tally: (key) => document.querySelector(`[data-tally="${key}"]`),
  };

  const state = { data: null, comp: "all", venue: "all", nextId: null };
  let refreshTimer = null;

  const matchesFilter = (match) =>
    (state.comp === "all" || match.competition === state.comp) &&
    (state.venue === "all" || (state.venue === "home") === match.bvbHome);

  const rowId = (match) => (match.id === state.nextId ? "naechstes" : `spiel-${match.id}`);

  // --- Bilanz ---------------------------------------------------------------------

  const renderTally = () => {
    const { data } = state;
    const played = data.matches.filter((match) => matchesFilter(match) && match.status === "finished" && match.score);
    const count = { w: 0, d: 0, l: 0 };
    let scored = 0;
    let conceded = 0;

    played.forEach((match) => {
      count[outcomeOf(match)] += 1;
      scored += match.bvbHome ? match.score.home : match.score.away;
      conceded += match.bvbHome ? match.score.away : match.score.home;
    });

    ["w", "d", "l"].forEach((key) => {
      els.tally(key).textContent = String(count[key]);
    });
    els.tally("goals").textContent = played.length ? `${scored}:${conceded}` : "–";
    els.tally("standing").textContent = data.standing
      ? `Platz ${data.standing.position} · ${data.standing.points} Punkte`
      : "Noch keine Tabelle";

    const form = played.slice(-5);
    els.tally("form").innerHTML = form.length
      ? form
          .map((match) => {
            const outcome = outcomeOf(match);
            const label = `${OUTCOME_LABEL[outcome]} gegen ${opponent(match)}, ${match.score.home}:${match.score.away}`;
            return `<li class="form-pip form-${outcome}" title="${escapeHtml(label)}"><span aria-hidden="true">${
              { w: "S", d: "U", l: "N" }[outcome]
            }</span><span class="visually-hidden">${escapeHtml(label)}</span></li>`;
          })
          .join("")
      : '<li class="form-empty">Noch kein Spiel gespielt</li>';
  };

  // --- Saisonpuls -----------------------------------------------------------------

  const renderPulse = () => {
    const { matches } = state.data;
    let lastMonth = "";
    // Monate mit nur einem Spiel bekommen keine Beschriftung, sonst überlappen die Kürzel.
    const monthCounts = new Map();
    matches.forEach((match) => {
      const key = fmt({ month: "short" }).format(new Date(match.kickoff)).replace(".", "");
      monthCounts.set(key, (monthCounts.get(key) || 0) + 1);
    });
    let nowPlaced = false;

    els.pulse.innerHTML = matches
      .map((match) => {
        const date = new Date(match.kickoff);
        const month = fmt({ month: "short" }).format(date).replace(".", "");
        const monthStart = month !== lastMonth && monthCounts.get(month) > 1;
        lastMonth = month;
        const outcome = outcomeOf(match);
        const kind = match.status === "live" ? "live" : outcome || (match.status === "pending" ? "pending" : "upcoming");
        const score = match.score ? ` ${match.score.home}:${match.score.away}` : "";
        const tip = `${fmtDay.format(date)} ${homeName(match)} – ${awayName(match)}${score}`;
        const label = `${fmtLong.format(date)}, ${match.competitionName}: ${homeName(match)} gegen ${awayName(match)}${
          score ? `,${score}` : ""
        }${outcome ? `, ${OUTCOME_LABEL[outcome]}` : ""}`;

        let nowMarker = "";
        if (!nowPlaced && (match.status === "upcoming" || match.status === "live")) {
          nowPlaced = true;
          nowMarker = '<li class="pulse-now" aria-hidden="true"><span>Jetzt</span></li>';
        }

        return `${nowMarker}<li class="pulse-item${monthStart ? " is-month-start" : ""}" data-match="${match.id}"${
          monthStart ? ` data-month="${escapeHtml(month)}"` : ""
        }>
          <a class="pulse-bar pulse-${kind} pulse-comp-${match.competition}" href="#${rowId(match)}" data-tip="${escapeHtml(tip)}" aria-label="${escapeHtml(label)}"><span class="pulse-fill"></span></a>
        </li>`;
      })
      .join("");

    // Balkenhöhe nach Tordifferenz – per CSSOM, weil die CSP Inline-Styles verbietet.
    matches.forEach((match, index) => {
      const bar = els.pulse.querySelector(`[data-match="${match.id}"] .pulse-bar`);
      bar.style.setProperty("--i", String(index));
      const outcome = outcomeOf(match);
      if (outcome !== "w" && outcome !== "l") return;
      const strength = Math.min(Math.abs(goalDiff(match)), 4);
      bar.style.setProperty("--h", String(0.34 + strength * 0.165));
    });

    const now = els.pulse.querySelector(".pulse-now");
    if (now && els.pulseScroll.scrollWidth > els.pulseScroll.clientWidth) {
      els.pulseScroll.scrollLeft = now.offsetLeft - els.pulseScroll.clientWidth * 0.6;
    }
  };

  // --- Spielliste -----------------------------------------------------------------

  const resultMarkup = (match, outcome) => {
    const date = new Date(match.kickoff);

    if (match.status === "live") {
      return `<span class="fx-live">Live</span><span class="fx-score">${match.score.home}:${match.score.away}</span>`;
    }
    if (match.status === "finished" && match.score) {
      return `<span class="fx-score">${match.score.home}:${match.score.away}</span><span class="fx-outcome">${OUTCOME_LABEL[outcome]}</span>`;
    }
    if (match.status === "pending" || match.status === "finished") {
      return '<span class="fx-pending">Ergebnis folgt</span>';
    }
    if (match.id === state.nextId) {
      return `<span class="fx-score fx-score-open">${fmtTime.format(date)}</span><span class="fx-outcome" data-relative="${escapeHtml(
        match.kickoff
      )}">${relativeDay(date)}</span>`;
    }
    return '<span class="fx-score fx-score-open" aria-hidden="true">–:–</span>';
  };

  const fixtureMarkup = (match) => {
    const date = new Date(match.kickoff);
    const outcome = outcomeOf(match);
    const isNext = match.id === state.nextId;
    const classes = [
      "fx",
      outcome ? `fx-${outcome}` : "",
      match.status === "upcoming" ? "fx-upcoming" : "",
      match.status === "live" ? "fx-is-live" : "",
      isNext ? "fx-next" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `<li class="${classes}" id="${rowId(match)}" data-comp="${match.competition}" data-home="${match.bvbHome}">
      <div class="fx-date">
        <span class="fx-wd">${escapeHtml(fmtWeekday.format(date).replace(".", ""))}</span>
        <span class="fx-day">${escapeHtml(fmtDay.format(date))}</span>
        <span class="fx-time">${escapeHtml(fmtTime.format(date))}<span class="fx-uhr"> Uhr</span></span>
      </div>
      <div class="fx-main">
        ${isNext ? '<p class="fx-flag">Nächstes Spiel</p>' : ""}
        <p class="fx-meta">
          <span class="fx-comp">${escapeHtml(match.competitionName)}</span>
          <span>${escapeHtml(match.round)}</span>
          <span class="fx-venue">${match.bvbHome ? "Heim" : "Auswärts"}</span>
        </p>
        <p class="fx-teams">
          <span class="${match.bvbHome ? "is-bvb" : ""}">${escapeHtml(homeName(match))}</span>
          <span class="fx-dash" aria-hidden="true">–</span>
          <span class="visually-hidden">gegen</span>
          <span class="${match.bvbHome ? "" : "is-bvb"}">${escapeHtml(awayName(match))}</span>
        </p>
      </div>
      <div class="fx-result">${resultMarkup(match, outcome)}</div>
    </li>`;
  };

  const renderFixtures = () => {
    const groups = [];

    state.data.matches.forEach((match) => {
      const month = fmtMonth.format(new Date(match.kickoff));
      const last = groups[groups.length - 1];
      if (last && last.month === month) last.matches.push(match);
      else groups.push({ month, matches: [match] });
    });

    els.fixtures.innerHTML = groups
      .map(
        (group) => `<section class="fx-month" aria-label="${escapeHtml(group.month)}">
          <h3 class="fx-month-title">${escapeHtml(group.month.split(" ")[0])}<span>${escapeHtml(group.month.split(" ")[1] || "")}</span></h3>
          <ol class="fx-list">${group.matches.map(fixtureMarkup).join("")}</ol>
        </section>`
      )
      .join("");
  };

  // --- Filter ---------------------------------------------------------------------

  const applyFilter = () => {
    let visible = 0;

    els.fixtures.querySelectorAll(".fx-month").forEach((section) => {
      let inMonth = 0;
      section.querySelectorAll(".fx").forEach((row) => {
        const match = state.byId.get(row.id === "naechstes" ? state.nextId : Number(row.id.replace("spiel-", "")));
        const show = matchesFilter(match);
        row.hidden = !show;
        if (show) inMonth += 1;
      });
      section.hidden = inMonth === 0;
      visible += inMonth;
    });

    els.pulse.querySelectorAll(".pulse-item").forEach((item) => {
      item.classList.toggle("is-dim", !matchesFilter(state.byId.get(Number(item.dataset.match))));
    });

    els.note.hidden = visible > 0;
    if (!visible) els.note.textContent = "Für diese Auswahl gibt es in dieser Saison keine Spiele.";

    document.querySelectorAll("[data-filter-comp]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.filterComp === state.comp));
    });
    document.querySelectorAll("[data-filter-venue]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.filterVenue === state.venue));
    });

    renderTally();
  };

  document.querySelector("[data-filterbar]").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !state.data) return;
    if (button.dataset.filterComp) state.comp = button.dataset.filterComp;
    if (button.dataset.filterVenue) state.venue = button.dataset.filterVenue;
    applyFilter();
  });

  // --- Springen -------------------------------------------------------------------

  const highlight = (row) => {
    row.classList.remove("is-flash");
    void row.offsetWidth;
    row.classList.add("is-flash");
  };

  const jumpTo = (id) => {
    const row = document.getElementById(id);
    if (!row) return;
    if (row.hidden) {
      state.comp = "all";
      state.venue = "all";
      applyFilter();
    }
    row.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "center" });
    highlight(row);
    history.replaceState(null, "", `#${id}`);
  };

  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#naechstes"], a[href^="#spiel-"]');
    if (!link) return;
    event.preventDefault();
    jumpTo(link.getAttribute("href").slice(1));
  });

  // --- Laden ----------------------------------------------------------------------

  const updateRelative = () => {
    document.querySelectorAll("[data-relative]").forEach((element) => {
      element.textContent = relativeDay(new Date(element.dataset.relative));
    });
  };

  const render = () => {
    const { data } = state;
    const next = data.matches.find((match) => match.status === "live" || match.status === "upcoming");
    state.nextId = next ? next.id : null;
    state.byId = new Map(data.matches.map((match) => [match.id, match]));

    els.seasonLabel.textContent = data.season.slice(2);
    document.title = `Spielplan ${data.season} | Bottwartal Borussen`;
    els.jumpNext.hidden = !next;

    if (!data.matches.length) {
      els.fixtures.innerHTML = '<p class="fixtures-empty">Für diese Saison ist noch kein Spielplan veröffentlicht.</p>';
      els.pulse.innerHTML = "";
      renderTally();
      return;
    }

    document.querySelectorAll("[data-count]").forEach((element) => {
      const key = element.dataset.count;
      element.textContent = String(data.matches.filter((match) => key === "all" || match.competition === key).length);
    });

    renderPulse();
    renderFixtures();
    applyFilter();

    if (data.incomplete) {
      els.note.hidden = false;
      els.note.textContent = "Ein Wettbewerb konnte gerade nicht geladen werden. Die Liste ist eventuell unvollständig.";
    }
  };

  const showError = () => {
    els.fixtures.innerHTML = `<div class="fixtures-error">
      <p>Der Spielplan ist gerade nicht erreichbar.</p>
      <button type="button" class="button button-black button-small" data-retry>Erneut versuchen</button>
    </div>`;
    els.fixtures.querySelector("[data-retry]").addEventListener("click", () => load());
  };

  const load = async ({ quiet = false } = {}) => {
    try {
      const response = await fetch("/api/site/season", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      state.data = await response.json();
      render();

      if (!quiet && location.hash.length > 1) {
        const target = document.getElementById(location.hash.slice(1));
        if (target?.classList.contains("fx")) jumpTo(target.id);
      }

      clearTimeout(refreshTimer);
      if (state.data.matches.some((match) => match.status === "live")) {
        refreshTimer = setTimeout(() => load({ quiet: true }), 60000);
      }
    } catch (error) {
      if (!state.data) showError();
    }
  };

  setInterval(updateRelative, 60000);
  load();
})();
