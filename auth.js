const form = document.querySelector("[data-login-form]");
const message = document.querySelector("[data-auth-message]");
const params = new URLSearchParams(window.location.search);
const requestedNext = params.get("next");
// Nur interne Pfade zulassen; "//andere-seite.de" wäre sonst eine Weiterleitung nach außen.
const safeNext = requestedNext && /^\/(?![/\\])/.test(requestedNext) ? requestedNext : "/members.html";

const resolveDestination = (session) => {
  if (safeNext === "/admin.html" && !session.user?.isAdmin) {
    return "/members.html";
  }

  return safeNext;
};

const checkExistingSession = async () => {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  const session = await response.json();

  if (!response.ok) {
    message.textContent = session.error || "Login-Server nicht erreichbar.";
    return;
  }

  if (session.authenticated) {
    window.location.href = resolveDestination(session);
  }
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";

  const formData = new FormData(form);
  const submitButton = form.querySelector("button[type=submit]");
  submitButton.disabled = true;

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        email: String(formData.get("email") || "").trim(),
        password: String(formData.get("password") || ""),
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || "Login fehlgeschlagen. Bitte später erneut versuchen.");
    }

    const sessionResponse = await fetch("/api/session", { credentials: "same-origin" });
    const session = await sessionResponse.json();
    window.location.href = resolveDestination(session);
  } catch (error) {
    message.textContent =
      error instanceof TypeError ? "Login-Server nicht erreichbar. Bitte Internetverbindung prüfen." : error.message;
    submitButton.disabled = false;
  }
});

checkExistingSession().catch(() => {
  message.textContent = "Login-Server nicht erreichbar.";
});
