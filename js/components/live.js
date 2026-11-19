// components/live.js — the Live TV page.
//   • Live now ........ the stream, with a Play button (nothing starts until you press it)
//   • Not live ........ a countdown to the next service, and the weekly schedule
// While waiting it quietly checks every 45 seconds, so the page switches to the stream by itself
// when the service begins.
import { bootApp } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { mountPlayer } from "../player.js";
import { DAY_NAMES, formatTime, nextOccurrence, describeOccurrence, countdownText, sortedWeek } from "../schedule.js";
import { escapeHtml, safeUrl } from "../util.js";

const POLL_MS = 45000;

export async function renderLive() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({ back: true, backHref: "media.html", rightIcon: null, title: "Live TV" });
  const root = document.getElementById("live-root");

  const [liveRes, scheduleRes] = await Promise.all([
    supabase.from("media_live").select("*").eq("id", 1).maybeSingle(),
    supabase.from("live_schedule").select("*"),
  ]);
  const schedule = scheduleRes.error ? [] : sortedWeek(scheduleRes.data || []);
  let live = liveRes.data;
  let player = null;
  let ticker = null;
  let poller = null;

  const isLive = () => Boolean(live?.is_live && safeUrl(live.stream_url));

  function scheduleListHTML(next) {
    if (!schedule.length) {
      return live?.schedule_text
        ? `<p class="live-note">${escapeHtml(live.schedule_text)}</p>`
        : `<p class="live-note">The weekly schedule hasn\u2019t been added yet.</p>`;
    }
    return schedule
      .map((e) => {
        const isNext = next && next.entry.id === e.id;
        return `<div class="schedule-row${isNext ? " next" : ""}">
          <div class="schedule-day">${DAY_NAMES[e.day]}</div>
          <div class="schedule-title">${escapeHtml(e.title)}</div>
          <div class="schedule-time">${formatTime(e.start_time)}${isNext ? '<span class="schedule-tag">Next</span>' : ""}</div>
        </div>`;
      })
      .join("");
  }

  function stopTimers() {
    if (ticker) clearInterval(ticker);
    ticker = null;
    if (poller) clearInterval(poller);
    poller = null;
    if (player) player.destroy();
    player = null;
  }

  function render() {
    stopTimers();
    const next = nextOccurrence(schedule);

    if (isLive()) {
      root.innerHTML = `
        <div class="live-pill"><span class="live-dot"></span> LIVE NOW</div>
        <h1 class="watch-title" style="margin-top:12px;">Live service</h1>
        <p class="watch-sub">${escapeHtml(live.schedule_text || "Join us online")}</p>
        <div id="live-player"></div>
        <h2 class="section-title" style="margin-top:26px;">Weekly schedule</h2>
        <div class="schedule-list">${scheduleListHTML(next)}</div>`;
      player = mountPlayer(root.querySelector("#live-player"), { title: "Live service", subtitle: live.schedule_text || "Flood Church", url: live.stream_url }, { autoplay: false });
      return;
    }

    root.innerHTML = `
      <div class="live-card">
        <div class="live-label">${next ? "NEXT SERVICE" : "LIVE TV"}</div>
        <h1 class="live-next">${next ? escapeHtml(describeOccurrence(next)) : "We\u2019re not live right now"}</h1>
        ${next ? `<div class="live-sub">${escapeHtml(next.entry.title)}</div><div class="live-countdown" id="live-countdown">&mdash;</div>` : ""}
        <p class="live-note">We\u2019re not live right now. This page switches to the live stream by itself as soon as we start.</p>
      </div>
      <h2 class="section-title" style="margin-top:26px;">Weekly schedule</h2>
      <div class="schedule-list">${scheduleListHTML(next)}</div>`;

    if (next) {
      const el = root.querySelector("#live-countdown");
      const tick = () => {
        const left = next.date - new Date();
        if (left <= 0) {
          render(); // the service has just started: show whatever comes next
          return;
        }
        el.textContent = countdownText(left);
      };
      tick();
      ticker = setInterval(tick, 1000);
    }

    // Check now and then whether the service has gone live.
    poller = setInterval(async () => {
      if (document.hidden) return;
      const { data } = await supabase.from("media_live").select("*").eq("id", 1).maybeSingle();
      if (data) {
        live = data;
        if (isLive()) render();
      }
    }, POLL_MS);
  }

  render();
}
