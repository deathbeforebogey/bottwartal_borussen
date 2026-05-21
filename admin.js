const statusNode = document.querySelector("[data-admin-status]");
const sectionForm = document.querySelector("[data-section-form]");
const contentForm = document.querySelector("[data-content-form]");
const articleForm = document.querySelector("[data-article-form]");
const eventForm = document.querySelector("[data-event-form]");
const userForm = document.querySelector("[data-user-form]");
const articlesList = document.querySelector("[data-articles-list]");
const eventsList = document.querySelector("[data-events-list]");
const usersList = document.querySelector("[data-users-list]");
const sectionsList = document.querySelector("[data-sections-list]");

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || "Aktion fehlgeschlagen.");
  }

  return data;
};

const setStatus = (message) => {
  statusNode.textContent = message;
};

const showSetupMessage = (target, message) => {
  target.innerHTML = `
    <div class="admin-help">
      <strong>Setup erforderlich</strong>
      <p>${message}</p>
      <p>Führe in Supabase den SQL-Inhalt aus: <code>supabase/member-events.sql</code></p>
    </div>
  `;
};

const fillForm = (form, values) => {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements[key];
    if (!field) return;

    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = value ?? "";
    }
  });
};

const resetForm = (form) => {
  form.reset();
  if (form.elements.id) form.elements.id.value = "";
};

const loadContent = async () => {
  const items = await api("/api/admin/content");
  contentForm.innerHTML = items
    .map(
      (item) => `
        <label>
          ${item.label}
          <textarea name="${item.key}" data-label="${item.label}" rows="3">${item.value}</textarea>
        </label>
      `
    )
    .join("");
  contentForm.insertAdjacentHTML("beforeend", '<button class="button primary" type="submit">Texte speichern</button>');
};

const loadSections = async () => {
  const sections = await api("/api/admin/sections");
  sectionsList.innerHTML = sections
    .map(
      (section) => `
        <article class="admin-row">
          <div>
            <strong>${section.sort_order}. ${section.title}</strong>
            <span>${section.type} · ${section.visible ? "sichtbar" : "ausgeblendet"}</span>
          </div>
          <button type="button" data-edit-section="${section.id}">Bearbeiten</button>
          <button type="button" data-delete-section="${section.id}">Löschen</button>
        </article>
      `
    )
    .join("");

  sectionsList.querySelectorAll("[data-edit-section]").forEach((button) => {
    button.addEventListener("click", () => {
      const section = sections.find((item) => item.id === button.dataset.editSection);
      fillForm(sectionForm, section);
    });
  });

  sectionsList.querySelectorAll("[data-delete-section]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/admin/sections/${button.dataset.deleteSection}`, { method: "DELETE" });
      await loadSections();
      setStatus("Block gelöscht.");
    });
  });
};

const loadArticles = async () => {
  const articles = await api("/api/admin/articles");
  articlesList.innerHTML = articles
    .map(
      (article) => `
        <article class="admin-row">
          <div>
            <strong>${article.title}</strong>
            <span>${article.published ? "veröffentlicht" : "Entwurf"}</span>
          </div>
          <button type="button" data-edit-article="${article.id}">Bearbeiten</button>
          <button type="button" data-delete-article="${article.id}">Löschen</button>
        </article>
      `
    )
    .join("");

  articlesList.querySelectorAll("[data-edit-article]").forEach((button) => {
    button.addEventListener("click", () => {
      const article = articles.find((item) => item.id === button.dataset.editArticle);
      fillForm(articleForm, article);
    });
  });

  articlesList.querySelectorAll("[data-delete-article]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/admin/articles/${button.dataset.deleteArticle}`, { method: "DELETE" });
      await loadArticles();
      setStatus("Artikel gelöscht.");
    });
  });
};

const loadEvents = async () => {
  const events = await api("/api/admin/events");
  eventsList.innerHTML = events
    .map(
      (event) => `
        <article class="admin-row">
          <div>
            <strong>${event.title}</strong>
            <span>${event.event_date} · ${event.event_time}</span>
          </div>
          <button type="button" data-edit-event="${event.id}">Bearbeiten</button>
          <button type="button" data-delete-event="${event.id}">Löschen</button>
        </article>
      `
    )
    .join("");

  eventsList.querySelectorAll("[data-edit-event]").forEach((button) => {
    button.addEventListener("click", () => {
      const event = events.find((item) => item.id === button.dataset.editEvent);
      fillForm(eventForm, event);
    });
  });

  eventsList.querySelectorAll("[data-delete-event]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/admin/events/${button.dataset.deleteEvent}`, { method: "DELETE" });
      await loadEvents();
      setStatus("Termin gelöscht.");
    });
  });
};

const loadUsers = async () => {
  const users = await api("/api/admin/users");
  usersList.innerHTML = users
    .map(
      (user) => `
        <article class="admin-row">
          <div>
            <strong>${user.email}</strong>
            <span>${user.displayName || "kein Anzeigename"} · ${user.role} · ${user.last_sign_in_at || "noch kein Login"}</span>
          </div>
          <button type="button" data-edit-user="${user.id}">Bearbeiten</button>
          <button type="button" data-delete-user="${user.id}">Löschen</button>
        </article>
      `
    )
    .join("");

  usersList.querySelectorAll("[data-edit-user]").forEach((button) => {
    button.addEventListener("click", () => {
      const user = users.find((item) => item.id === button.dataset.editUser);
      fillForm(userForm, {
        id: user.id,
        email: user.email,
        displayName: user.displayName || "",
        role: user.role,
      });
      userForm.elements.password.value = "";
    });
  });

  usersList.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/admin/users/${button.dataset.deleteUser}`, { method: "DELETE" });
      await loadUsers();
      setStatus("Mitglied gelöscht.");
    });
  });
};

contentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const items = [...contentForm.querySelectorAll("textarea")].map((field) => ({
    key: field.name,
    label: field.dataset.label,
    value: field.value,
  }));
  await api("/api/admin/content", { method: "PUT", body: JSON.stringify({ items }) });
  setStatus("Texte gespeichert.");
});

sectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(sectionForm);
  const id = formData.get("id");
  const payload = Object.fromEntries(formData.entries());
  delete payload.id;
  payload.visible = formData.get("visible") === "on";
  await api(id ? `/api/admin/sections/${id}` : "/api/admin/sections", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  resetForm(sectionForm);
  sectionForm.elements.sort_order.value = "100";
  sectionForm.elements.visible.checked = true;
  await loadSections();
  setStatus("Startseiten-Block gespeichert.");
});


articleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(articleForm);
  const id = formData.get("id");
  const payload = {
    title: formData.get("title"),
    excerpt: formData.get("excerpt"),
    body: formData.get("body"),
    published: formData.get("published") === "on",
  };
  await api(id ? `/api/admin/articles/${id}` : "/api/admin/articles", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  resetForm(articleForm);
  await loadArticles();
  setStatus("Artikel gespeichert.");
});

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(eventForm);
  const id = formData.get("id");
  const payload = Object.fromEntries(formData.entries());
  delete payload.id;
  await api(id ? `/api/admin/events/${id}` : "/api/admin/events", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  resetForm(eventForm);
  await loadEvents();
  setStatus("Termin gespeichert.");
});

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(userForm);
  const id = formData.get("id");
  const payload = Object.fromEntries(formData.entries());
  delete payload.id;
  if (!payload.password) delete payload.password;
  await api(id ? `/api/admin/users/${id}` : "/api/admin/users", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  resetForm(userForm);
  await loadUsers();
  setStatus("Mitglied gespeichert.");
});

document.querySelector("[data-article-reset]").addEventListener("click", () => resetForm(articleForm));
document.querySelector("[data-event-reset]").addEventListener("click", () => resetForm(eventForm));
document.querySelector("[data-user-reset]").addEventListener("click", () => resetForm(userForm));
document.querySelector("[data-section-reset]").addEventListener("click", () => {
  resetForm(sectionForm);
  sectionForm.elements.sort_order.value = "100";
  sectionForm.elements.visible.checked = true;
});
document.querySelector("[data-admin-logout]").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  window.location.href = "/";
});

const initAdmin = async () => {
  const results = await Promise.allSettled([
    loadSections(),
    loadContent(),
    loadArticles(),
    loadEvents(),
    loadUsers(),
  ]);

  if (results[0].status === "rejected") {
    showSetupMessage(sectionsList, results[0].reason.message);
  }

  if (results[1].status === "rejected") {
    showSetupMessage(contentForm, results[1].reason.message);
  }

  if (results[2].status === "rejected") {
    showSetupMessage(articlesList, results[2].reason.message);
  }

  if (results[3].status === "rejected") {
    showSetupMessage(eventsList, results[3].reason.message);
  }

  if (results[4].status === "rejected") {
    showSetupMessage(usersList, results[4].reason.message);
  }

  const failed = results.filter((result) => result.status === "rejected").length;
  setStatus(failed ? `${failed} Bereich(e) brauchen noch Supabase-Setup.` : "Adminbereich bereit.");
};

initAdmin();
