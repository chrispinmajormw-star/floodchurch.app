// util.ts — tiny shared helpers with TypeScript typings.

/** Add a page‑specific CSS class to the main ".page" container. */
export function applyPageClass(cls: string): void {
  document.querySelector('.page')?.classList.add(cls);
}

/** Escape text so it can be safely inserted into innerHTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Human‑readable "time ago" strings. */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Only lets through in‑app pages or http(s) links — never javascript: URLs. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = String(url).trim();
  if (/^[a-z0-9][a-z0-9\-_/]*\.html(\?[^\s#]*)?(#\S*)?$/i.test(u)) return u;
  if (/^https?:\/\/\S+$/i.test(u)) return u;
  return null;
}

/** Render a loading spinner into a container element. */
export function showSpinner(container: HTMLElement): void {
  container.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';
}

/** Render an empty-state message into a container element. */
export function showEmptyState(container: HTMLElement, title: string, message: string): void {
  container.innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
      </svg>
      <h3>${title}</h3>
      <p>${message}</p>
    </div>`;
}

/** Toggle dark mode on the body element and persist preference. */
export function toggleDarkMode(): void {
  const isDark = document.body.classList.toggle("theme-dark");
  try { localStorage.setItem("theme", isDark ? "dark" : "light"); } catch {}
}

/** Apply saved theme preference on page load. */
export function applySavedTheme(): void {
  try {
    if (localStorage.getItem("theme") === "dark") {
      document.body.classList.add("theme-dark");
    }
  } catch {}
}
