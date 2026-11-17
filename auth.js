const form = document.querySelector("[data-login-form]");
const message = document.querySelector("[data-auth-message]");
const capsHint = document.querySelector("[data-caps-hint]");
const submitButton = form.querySelector("button[type=submit]");
const params = new URLSearchParams(window.location.search);
const requestedNext = params.get("next");
// Nur interne Pfade zulassen; "//andere-seite.de" wäre sonst eine Weiterleitung nach außen.
const safeNext = requestedNext && /^\/(?![/\\])/.test(requestedNext) ? requestedNext : "/members.html";

const resolveDestination = (session) =>
  safeNext === "/admin.html" && !session.user?.isAdmin ? "/members.html" : safeNext;

const showMessage = (text) => {
  message.textContent = text;
};

const checkExistingSession = async () => {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  const session = await response.json();

  if (!response.ok) {
    showMessage(session.error || "Der Login ist gerade nicht erreichbar.");
    return;
  }

  if (session.authenticated) {
    window.location.replace(resolveDestination(session));
  }
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;

  if (!email || !password) {
    showMessage("Bitte gib E-Mail und Passwort ein.");
    (email ? form.elements.password : form.elements.email).focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "Wird angemeldet …";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "Anmelden hat nicht geklappt. Bitte später erneut versuchen.");
    }

    const sessionResponse = await fetch("/api/session", { credentials: "same-origin" });
    window.location.replace(resolveDestination(await sessionResponse.json()));
  } catch (error) {
    showMessage(
      error instanceof TypeError ? "Keine Verbindung zum Server. Bitte prüfe dein Internet." : error.message
    );
    form.elements.password.select();
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = "Anmelden";
  }
});

form.elements.password.addEventListener("keyup", (event) => {
  capsHint.hidden = !event.getModifierState?.("CapsLock");
});

document.querySelectorAll("[data-reveal]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.reveal);
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", visible ? "Passwort verbergen" : "Passwort anzeigen");
  });
});

checkExistingSession().catch(() => showMessage("Der Login ist gerade nicht erreichbar."));
