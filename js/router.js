import './router.js';

/** Simple client‑side router for the FloodChurch SPA.
 *  It intercepts clicks on <a> elements that point to .html files within the app,
 *  loads the corresponding component module dynamically, and swaps the page content
 *  without a full reload.
 */

const routes = {
  'index.html': async () => {
    const mod = await import('./components/home.js');
    await mod.renderHome();
  },
  'bible.html': async () => {
    const mod = await import('./components/bible.js');
    await mod.renderBible();
  },
  'media.html': async () => {
    const mod = await import('./components/media.js');
    await mod.renderMedia();
  },
  'give.html': async () => {
    const mod = await import('./components/give.js');
    await mod.renderGive();
  },
  'profile.html': async () => {
    const mod = await import('./components/profile.js');
    await mod.renderProfile();
  },
  // add more routes as needed
};

/** Find the page name (e.g. "bible.html") from the current location. */
function currentPage() {
  const path = location.pathname.split('/').pop();
  return path || 'index.html';
}

/** Load and render the route matching the current URL. */
async function handleRoute() {
  const page = currentPage();
  const loader = routes[page];
  if (loader) {
    try {
      await loader();
    } catch (e) {
      console.error('Failed to load route', page, e);
    }
  } else {
    console.warn('No route defined for', page);
  }
}

/** Intercept in‑page navigation clicks so we stay inside the SPA. */
function interceptLinks(event) {
  const anchor = event.target.closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#')) return;
  // Only handle internal .html links
  if (!href.endsWith('.html')) return;

  event.preventDefault();
  history.pushState(null, '', href);
  handleRoute();
}

// Initial load
handleRoute();

// Listen for navigation clicks and browser back/forward
window.addEventListener('click', interceptLinks);
window.addEventListener('popstate', handleRoute);
