const form = document.querySelector("[data-login-form]");
const message = document.querySelector("[data-auth-message]");
const params = new URLSearchParams(window.location.search);
const requestedNext = params.get("next");
const safeNext = requestedNext && requestedNext.startsWith("/") ? requestedNext : "/members.html";

const resolveDestination = (session) => {
  if (safeNext === "/admin.html" && !session.user?.isAdmin) {
    return "/members.html";
  }

  return safeNext;
};

const checkExistingSession = async () => {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  const session = await response.json();

  if (session.authenticated) {
    window.location.href = resolveDestination(session);
  }
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";

  const formData = new FormData(form);

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
      throw new Error("Login fehlgeschlagen. Benutzername oder Passwort ist falsch.");
    }

    const sessionResponse = await fetch("/api/session", { credentials: "same-origin" });
    const session = await sessionResponse.json();
    window.location.href = resolveDestination(session);
  } catch (error) {
    message.textContent = error.message;
  }
});

checkExistingSession().catch(() => {
  message.textContent = "Login-Server nicht erreichbar.";
});
