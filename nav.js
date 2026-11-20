// Kopfzeile der öffentlichen Seiten: mobiles Menü und Schatten beim Scrollen.
(() => {
  const header = document.querySelector("[data-header]");
  const menuButton = document.querySelector("[data-menu-button]");
  const nav = document.querySelector("[data-nav]");
  if (!header || !menuButton || !nav) return;

  const setMenuOpen = (isOpen) => {
    header.classList.toggle("is-open", isOpen);
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Navigation schließen" : "Navigation öffnen");
  };

  menuButton.addEventListener("click", () => setMenuOpen(!header.classList.contains("is-open")));
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && header.classList.contains("is-open")) {
      setMenuOpen(false);
      menuButton.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!header.contains(event.target)) setMenuOpen(false);
  });
  window.matchMedia("(min-width: 921px)").addEventListener("change", () => setMenuOpen(false));

  const updateHeader = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();
})();
