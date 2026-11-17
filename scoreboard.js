// Anzeigetafel: nächstes BVB-Spiel mit laufendem Countdown.
// Wird von Startseite und Mitgliederbereich genutzt. Daten kommen vom eigenen Server
// (/api/site/next-match), der OpenLigaDB abfragt – der Browser spricht nie mit Dritten.
(() => {
  const UNITS = [
    { key: "days", label: "Tage", one: "Tag" },
    { key: "hours", label: "Std" },
    { key: "minutes", label: "Min" },
    { key: "seconds", label: "Sek" },
  ];

  const escapeHtml = (value = "") =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const formatKickoff = (date) =>
    new Intl.DateTimeFormat("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    })
      .format(date)
      .replace(",", " ·")
      .concat(" Uhr");

  const formatKickoffLong = (date) =>
    new Intl.DateTimeFormat("de-DE", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    }).format(date);

  const splitDuration = (ms) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    return {
      days: Math.floor(total / 86400),
      hours: Math.floor((total % 86400) / 3600),
      minutes: Math.floor((total % 3600) / 60),
      seconds: total % 60,
    };
  };

  const clockMarkup = () => `
    <div class="sb-clock" aria-hidden="true">
      ${UNITS.map(
        (unit) => `
          <div class="sb-unit" data-unit="${unit.key}">
            <span class="sb-digits" data-digits>--</span>
            <span class="sb-unit-label" data-unit-label>${unit.label}</span>
          </div>`
      ).join("")}
    </div>`;

  // Ziffern einzeln setzen, damit nur die geänderte Stelle rollt.
  const setDigits = (container, text) => {
    const current = [...container.querySelectorAll(".sb-digit")];

    if (current.length !== text.length) {
      container.innerHTML = [...text].map((char) => `<span class="sb-digit">${char}</span>`).join("");
      return;
    }

    [...text].forEach((char, index) => {
      const digit = current[index];

      if (digit.textContent !== char) {
        digit.textContent = char;
        digit.classList.remove("is-rolling");
        // Reflow erzwingen, damit die Animation erneut startet.
        void digit.offsetWidth;
        digit.classList.add("is-rolling");
      }
    });
  };

  const render = (root, data) => {
    const match = data?.match;

    if (!match) {
      root.dataset.state = "empty";
      root.querySelector("[data-sb-teams]").innerHTML =
        '<span class="sb-team">BVB</span><span class="sb-vs">–</span><span class="sb-team is-open">offen</span>';
      root.querySelector("[data-sb-meta]").textContent = "Der nächste Spieltag ist noch nicht angesetzt.";
      root.querySelector("[data-sb-when]").textContent = "Spielplan folgt";
      return;
    }

    const kickoff = new Date(match.kickoff);
    const bvbClass = (isBvb) => (isBvb ? " is-bvb" : "");

    root.dataset.state = "ready";
    root.querySelector("[data-sb-teams]").innerHTML = `
      <span class="sb-team${bvbClass(match.bvbAtHome)}">${escapeHtml(match.home)}</span>
      <span class="sb-vs">:</span>
      <span class="sb-team${bvbClass(!match.bvbAtHome)}">${escapeHtml(match.away)}</span>`;
    root.querySelector("[data-sb-meta]").textContent = [match.competition, match.round].filter(Boolean).join(" · ");
    root.querySelector("[data-sb-when]").textContent = [formatKickoff(kickoff), match.venue].filter(Boolean).join(" · ");
    root.querySelector("[data-sb-sr]").textContent = `Nächstes Spiel: ${match.home} gegen ${match.away}, ${formatKickoffLong(
      kickoff
    )} Uhr.`;

    const units = Object.fromEntries(
      UNITS.map((unit) => [unit.key, root.querySelector(`[data-unit="${unit.key}"]`)])
    );

    const tick = () => {
      const remaining = kickoff.getTime() - Date.now();

      if (remaining <= 0) {
        root.dataset.state = "live";
        root.querySelector("[data-sb-when]").textContent = "Anpfiff! Das Spiel läuft.";
        return false;
      }

      const parts = splitDuration(remaining);
      UNITS.forEach((unit) => {
        const value = parts[unit.key];
        setDigits(units[unit.key].querySelector("[data-digits]"), String(value).padStart(2, "0"));

        if (unit.one) {
          units[unit.key].querySelector("[data-unit-label]").textContent = value === 1 ? unit.one : unit.label;
        }
      });
      return true;
    };

    // Bei ausgeblendetem Tab nicht weiterticken.
    let timer = null;
    const start = () => {
      if (timer || !tick()) return;
      timer = window.setInterval(() => {
        if (!tick()) stop();
      }, 1000);
    };
    const stop = () => {
      window.clearInterval(timer);
      timer = null;
    };

    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    start();
  };

  const mount = async (root) => {
    root.classList.add("scoreboard");
    root.dataset.state = "loading";
    root.innerHTML = `
      <div class="sb-head">
        <span class="sb-title">Nächstes Spiel</span>
        <span class="sb-meta" data-sb-meta>Spielplan wird geladen</span>
      </div>
      <div class="sb-teams" data-sb-teams>
        <span class="sb-team is-bvb">BVB</span><span class="sb-vs">:</span><span class="sb-team sb-skeleton">&nbsp;</span>
      </div>
      ${clockMarkup()}
      <p class="sb-when" data-sb-when>&nbsp;</p>
      <p class="visually-hidden" data-sb-sr aria-live="polite"></p>`;

    try {
      const response = await fetch("/api/site/next-match", { signal: AbortSignal.timeout(10000) });

      if (!response.ok) throw new Error();

      render(root, await response.json());
    } catch (error) {
      root.dataset.state = "error";
      root.querySelector("[data-sb-teams]").innerHTML = '<span class="sb-team is-bvb">BVB</span>';
      root.querySelector("[data-sb-meta]").textContent = "Spielplan gerade nicht erreichbar";
      root.querySelector("[data-sb-when]").textContent = "Bitte später noch einmal vorbeischauen.";
    }
  };

  document.querySelectorAll("[data-scoreboard]").forEach(mount);
})();
