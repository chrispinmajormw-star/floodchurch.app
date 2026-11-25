// components/events.js — lists all events (Upcoming / Past) and opens a
// detail modal with the full description when one is tapped. Supports
// deep-linking via ?id=<event-id> (used by Home's event rows).
import { bootApp } from "../App.js";
import { getViewer } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { ICONS } from "../icons.js";
import { openPoster, posterUrl } from "../poster-viewer.js";
import { escapeHtml, dateBadge } from "../util.js";

function formatWhen(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function openEventModal(event) {
  document.getElementById("event-modal-title").textContent = event.title;
  document.getElementById("event-modal-when").textContent = formatWhen(event.event_date);
  document.getElementById("event-modal-location").textContent = event.location || "";
  document.getElementById("event-modal-description").textContent =
    event.description || "No further details added yet.";

  // The flyer, if the admin added one: a picture they can tap to see full screen.
  const posterMount = document.getElementById("event-modal-poster");
  const poster = posterUrl(event.poster_url);
  if (poster) {
    posterMount.innerHTML = `
      <img src="${escapeHtml(poster)}" alt="" loading="lazy" decoding="async">
      <span class="event-poster-tag">${ICONS.expand} View poster</span>`;
    posterMount.hidden = false;
    posterMount.onclick = () => openPoster({ url: poster, title: event.title });
    posterMount.querySelector("img").addEventListener("error", () => {
      posterMount.hidden = true; // not available right now (no signal): the details still show
    });
  } else {
    posterMount.hidden = true;
    posterMount.innerHTML = "";
    posterMount.onclick = null;
  }
  document.getElementById("event-modal").classList.add("open");
}

function eventRow(event) {
  return `
    <div class="event-row" data-id="${escapeHtml(event.id)}" style="cursor:pointer;">
      ${dateBadge(event.event_date)}
      <div class="event-text">
        <p class="e-title">${escapeHtml(event.title)}</p>
        <p class="e-sub">${escapeHtml(formatWhen(event.event_date))}${event.location ? " · " + escapeHtml(event.location) : ""}</p>
      </div>
      <div class="chevron">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
      </div>
    </div>`;
}

export async function renderEvents() {
  await getViewer(); // open to everyone: no account needed (null = a visitor)

  bootApp({ back: true, backHref: "index.html", rightIcon: null, title: "Events" });

  const { data, error } = await supabase.from("events").select("*").order("event_date");

  const upcomingMount = document.getElementById("upcoming-events");
  const pastMount = document.getElementById("past-events");

  if (error) {
    upcomingMount.innerHTML = `<p style="color:var(--red);font-size:14px;">${error.message}</p>`;
    return;
  }

  const now = new Date();
  const events = data || [];
  const upcoming = events.filter((e) => new Date(e.event_date) >= now);
  const past = events.filter((e) => new Date(e.event_date) < now).reverse();

  upcomingMount.innerHTML = upcoming.map(eventRow).join("");
  document.getElementById("upcoming-empty").style.display = upcoming.length ? "none" : "block";

  pastMount.innerHTML = past.map(eventRow).join("");
  document.getElementById("past-empty").style.display = past.length ? "none" : "block";

  const eventsById = Object.fromEntries(events.map((e) => [e.id, e]));

  document.querySelectorAll("[data-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const event = eventsById[row.dataset.id];
      if (event) openEventModal(event);
    });
  });

  document.querySelectorAll(".modal-close").forEach((btn) => {
    btn.addEventListener("click", () => document.getElementById(btn.dataset.close).classList.remove("open"));
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("open");
    });
  });

  // Deep link: events.html?id=<uuid> opens straight to that event's detail.
  const params = new URLSearchParams(location.search);
  const deepLinkId = params.get("id");
  if (deepLinkId && eventsById[deepLinkId]) {
    openEventModal(eventsById[deepLinkId]);
  }
}
