const form = document.querySelector("[data-login-form]");
const message = document.querySelector("[data-auth-message]");

const checkExistingSession = async () => {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  const session = await response.json();

  if (session.authenticated) {
    window.location.href = "/members.html";
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

    window.location.href = "/members.html";
  } catch (error) {
    message.textContent = error.message;
  }
});

checkExistingSession().catch(() => {
  message.textContent = "Login-Server nicht erreichbar.";
});
