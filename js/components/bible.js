// components/bible.js — full-page KJV reader (book/chapter picker, drop-cap
// chapter numeral, floating prev/next) plus Daily Reading and Reading Plans
// tucked behind icon buttons as bottom-sheet modals.
//   • Daily Reading shows the latest Verse of the Day and Today's Devotion
//     posted from the dashboard.
//   • Reading Plans come from the reading_plans table; progress is real
//     (days completed, one tap per day) and saved per member.
import { bootApp, loadData } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { BIBLE_BOOKS } from "../bible-books.js";
import { escapeHtml } from "../util.js";

const LAST_READ_KEY = "flood-bible-last";
const BIBLE_API = "https://bible-api.com";
const FETCH_TIMEOUT_MS = 10000; // fail fast instead of hanging on a dead connection

/** fetch() with a hard timeout, so a dead/blocked connection fails in ~10s, not 30-120s. */
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Timed out reaching the Bible service — it may be down, or blocked on this network.");
    }
    throw new Error("Couldn't reach the Bible service — check your connection.");
  } finally {
    clearTimeout(timer);
  }
}

function openModal(id) {
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

function wireModals() {
  document.getElementById("picker-open").addEventListener("click", () => openModal("picker-modal"));
  document.getElementById("daily-open").addEventListener("click", () => openModal("daily-modal"));
  document.getElementById("plans-open").addEventListener("click", () => openModal("plans-modal"));

  document.querySelectorAll(".modal-close").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("open");
    });
  });

  document.getElementById("search-open").addEventListener("click", () => {
    const row = document.getElementById("search-row");
    const showing = row.style.display !== "none";
    row.style.display = showing ? "none" : "flex";
    if (!showing) document.getElementById("verse-search-input").focus();
  });
}

function initBibleReader() {
  const bookSelect = document.getElementById("book-select");
  const chapterSelect = document.getElementById("chapter-select");
  const textMount = document.getElementById("reader-text");
  const statusEl = document.getElementById("reader-status");
  const titleEl = document.getElementById("reader-title");
  const bannerEl = document.getElementById("book-banner");
  const prevBtn = document.getElementById("prev-chapter");
  const nextBtn = document.getElementById("next-chapter");
  const searchInput = document.getElementById("verse-search-input");

  bookSelect.innerHTML = BIBLE_BOOKS.map((b) => `<option value="${b.name}">${b.name}</option>`).join("");

  function populateChapters(bookName, selected) {
    const book = BIBLE_BOOKS.find((b) => b.name === bookName);
    const count = book ? book.chapters : 1;
    chapterSelect.innerHTML = Array.from({ length: count }, (_, i) => i + 1)
      .map((n) => `<option value="${n}">${n}</option>`)
      .join("");
    chapterSelect.value = selected || 1;
  }

  function renderVerses(verses, chapterNum) {
    if (!verses.length) {
      textMount.innerHTML = "";
      return;
    }
    const [first, ...rest] = verses;
    const dropcap = `<span class="reader-dropcap">${chapterNum}</span>${first.text.trim()} `;
    const restHtml = rest.map((v) => `<span class="verse-num">${v.verse}</span>${v.text.trim()} `).join("");
    textMount.innerHTML = dropcap + restHtml;
  }

  async function loadChapter(bookName, chapter) {
    statusEl.textContent = "Loading…";
    textMount.innerHTML = "";
    titleEl.textContent = `${bookName} ${chapter}`;
    bannerEl.style.display = String(chapter) === "1" ? "block" : "none";
    bannerEl.textContent = bookName.toUpperCase();

    try {
      const res = await fetchWithTimeout(`${BIBLE_API}/${encodeURIComponent(`${bookName} ${chapter}`)}?translation=kjv`);
      if (!res.ok) throw new Error("Couldn't find that passage.");
      const data = await res.json();
      if (!data.verses || !data.verses.length) throw new Error("No text found for that passage.");

      statusEl.textContent = "";
      renderVerses(data.verses, chapter);
      localStorage.setItem(LAST_READ_KEY, JSON.stringify({ book: bookName, chapter }));
    } catch (err) {
      statusEl.innerHTML = `${escapeHtml(err.message)} <button class="chip" id="retry-load" style="padding:4px 10px;margin-left:6px;">Try again</button>`;
      const retryBtn = document.getElementById("retry-load");
      if (retryBtn) retryBtn.addEventListener("click", () => loadChapter(bookName, chapter));
    }
  }

  bookSelect.addEventListener("change", () => {
    populateChapters(bookSelect.value, 1);
    loadChapter(bookSelect.value, 1);
    closeModal("picker-modal");
  });

  chapterSelect.addEventListener("change", () => {
    loadChapter(bookSelect.value, chapterSelect.value);
    closeModal("picker-modal");
  });

  prevBtn.addEventListener("click", () => {
    const bookIndex = BIBLE_BOOKS.findIndex((b) => b.name === bookSelect.value);
    let chapter = parseInt(chapterSelect.value, 10) - 1;
    let targetBookIndex = bookIndex;
    if (chapter < 1) {
      targetBookIndex = Math.max(0, bookIndex - 1);
      chapter = BIBLE_BOOKS[targetBookIndex].chapters;
    }
    bookSelect.value = BIBLE_BOOKS[targetBookIndex].name;
    populateChapters(bookSelect.value, chapter);
    loadChapter(bookSelect.value, chapter);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  nextBtn.addEventListener("click", () => {
    const bookIndex = BIBLE_BOOKS.findIndex((b) => b.name === bookSelect.value);
    const maxChapter = BIBLE_BOOKS[bookIndex].chapters;
    let chapter = parseInt(chapterSelect.value, 10) + 1;
    let targetBookIndex = bookIndex;
    if (chapter > maxChapter) {
      targetBookIndex = Math.min(BIBLE_BOOKS.length - 1, bookIndex + 1);
      chapter = 1;
    }
    bookSelect.value = BIBLE_BOOKS[targetBookIndex].name;
    populateChapters(bookSelect.value, chapter);
    loadChapter(bookSelect.value, chapter);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Free-text search — "John 3:16", "Psalm 23", "romans 8" all work,
  // since bible-api.com parses the reference itself.
  function runSearch(rawQuery) {
    const query = String(rawQuery || "").trim();
    if (!query) return;

    const match = BIBLE_BOOKS.find((b) => query.toLowerCase().startsWith(b.name.toLowerCase()));
    const chapterMatch = query.match(/(\d+)(?::\d+)?\s*$/);
    if (match) {
      populateChapters(match.name, chapterMatch ? chapterMatch[1] : 1);
      bookSelect.value = match.name;
      titleEl.textContent = `${match.name} ${chapterMatch ? chapterMatch[1] : ""}`.trim();
      bannerEl.style.display = "none";
    } else {
      titleEl.textContent = "Search";
      bannerEl.style.display = "none";
    }

    statusEl.textContent = "Loading…";
    textMount.innerHTML = "";
    fetchWithTimeout(`${BIBLE_API}/${encodeURIComponent(query)}?translation=kjv`)
      .then((res) => {
        if (!res.ok) throw new Error("Couldn't find that passage.");
        return res.json();
      })
      .then((data) => {
        if (!data.verses || !data.verses.length) throw new Error("No text found for that passage.");
        statusEl.textContent = "";
        textMount.innerHTML = data.verses
          .map((v) => `<span class="verse-num">${v.verse}</span>${v.text.trim()} `)
          .join("");
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
      .catch((err) => {
        statusEl.textContent = `${err.message} Try a format like "John 3:16" or "Psalm 23".`;
      });
  }

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch(searchInput.value);
  });

  // Restore last-read position, or default to John 3.
  let start = { book: "John", chapter: 3 };
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_READ_KEY));
    if (saved && BIBLE_BOOKS.some((b) => b.name === saved.book)) start = saved;
  } catch (e) {}

  bookSelect.value = start.book;
  populateChapters(start.book, start.chapter);
  loadChapter(start.book, start.chapter);

  return { runSearch };
}

/** Today's date as YYYY-MM-DD in the member's own time zone. */
function todayISO() {
  return new Date().toLocaleDateString("en-CA");
}

export async function renderBible() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({}); // no page topbar on this page, but still applies theme + bottom nav

  wireModals();
  const reader = initBibleReader();

  const [fallback, verseRes, devotionRes, plansRes, progressRes] = await Promise.all([
    loadData("data/bible.json").catch(() => null),
    supabase.from("verse_of_day").select("*").order("verse_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("devotions").select("*").order("devotion_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("reading_plans").select("*").order("sort_order"),
    supabase.from("reading_plan_progress").select("*").eq("user_id", authUser.id),
  ]);

  // ---- Daily Reading: latest verse + latest devotion -------------------------
  const verse = verseRes.data || fallback?.dailyReading || null;
  const devotion = devotionRes.data;
  const dailyMount = document.getElementById("daily-content");

  dailyMount.innerHTML =
    (verse
      ? `<div class="daily-card" style="border:none;padding:0;margin-bottom:18px;">
           <div class="eyebrow">VERSE OF THE DAY</div>
           <blockquote>\u201c${escapeHtml(verse.text)}\u201d</blockquote>
           <cite>${escapeHtml(verse.reference)}</cite>
           <div class="chip-row"><button class="chip" id="read-verse-btn">Read in the Bible</button></div>
         </div>`
      : `<p style="color:var(--text-dim);font-size:14px;">No verse posted yet.</p>`) +
    (devotion
      ? `<div class="daily-card" style="border:none;border-top:1px solid var(--border);border-radius:0;padding:18px 0 0;margin:0;">
           <div class="eyebrow">TODAY'S DEVOTION</div>
           <h3 style="font-size:16.5px;font-weight:800;margin:0 0 8px;">${escapeHtml(devotion.title)}</h3>
           <p style="font-size:14px;color:var(--text-dim);line-height:1.6;margin:0 0 10px;"><b style="color:var(--text);">${escapeHtml(devotion.reference || "")}${devotion.reference ? ":" : ""}</b> ${escapeHtml(devotion.body)}</p>
           ${devotion.tag ? `<span class="tag-pill">${escapeHtml(devotion.tag)}</span>` : ""}
         </div>`
      : "");

  const readBtn = document.getElementById("read-verse-btn");
  if (readBtn && verse) {
    readBtn.addEventListener("click", () => {
      closeModal("daily-modal");
      // "Romans 12:2 (NKJV)" → "Romans 12:2" — the reader always shows KJV.
      reader.runSearch(String(verse.reference).replace(/\s*\(.*?\)\s*$/, ""));
    });
  }

  // ---- Reading plans --------------------------------------------------------
  const plans = plansRes.data || [];
  const progressByTitle = {};
  (progressRes.data || []).forEach((row) => {
    progressByTitle[row.plan_title] = { days: row.days_completed ?? 0, last: row.last_read_on || null };
  });

  const plansMount = document.getElementById("plans");

  function plansHTML() {
    if (plansRes.error) {
      return `<p style="color:var(--text-dim);font-size:14px;">Reading plans aren't available yet.</p>`;
    }
    if (!plans.length) {
      return `<p style="color:var(--text-dim);font-size:14px;">No reading plans yet.</p>`;
    }
    const today = todayISO();
    return plans
      .map((plan) => {
        const p = progressByTitle[plan.title] || { days: 0, last: null };
        const total = plan.duration_days;
        const days = Math.min(p.days, total);
        const percent = Math.min(100, Math.round((days / total) * 100));
        const complete = days >= total;
        const doneToday = p.last === today;
        const label = complete ? "Completed ✓" : doneToday ? "Done for today ✓" : "Mark today's reading";
        return `
      <div class="plan-card">
        <div class="plan-top">
          <b>${escapeHtml(plan.title)}</b>
          <span>${total} days</span>
        </div>
        ${plan.description ? `<p class="plan-desc">${escapeHtml(plan.description)}</p>` : ""}
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        <div class="plan-top" style="margin-top:8px; margin-bottom:0;">
          <span class="plan-percent">Day ${days} of ${total} · ${percent}%</span>
          <button class="chip" data-plan="${escapeHtml(plan.title)}" ${complete || doneToday ? "disabled" : ""} style="padding:6px 12px;">${label}</button>
        </div>
      </div>`;
      })
      .join("");
  }

  function wireButtons() {
    plansMount.querySelectorAll("[data-plan]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const title = btn.dataset.plan;
        const plan = plans.find((p) => p.title === title);
        if (!plan) return;
        const current = progressByTitle[title] || { days: 0, last: null };
        const today = todayISO();
        // One day per day: ignore repeat taps (or a finished plan), whatever the button state.
        if (current.last === today || current.days >= plan.duration_days) return;
        const nextDays = Math.min(plan.duration_days, current.days + 1);

        btn.disabled = true;
        const { error } = await supabase.from("reading_plan_progress").upsert(
          {
            user_id: authUser.id,
            plan_title: title,
            days_completed: nextDays,
            // "percent" is kept in step for older screens; any started plan counts as at least 1%.
            percent: Math.min(100, Math.max(1, Math.round((nextDays / plan.duration_days) * 100))),
            last_read_on: today,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,plan_title" }
        );

        if (error) {
          btn.disabled = false;
          alert(`Couldn't save progress: ${error.message}`);
          return;
        }
        progressByTitle[title] = { days: nextDays, last: today };
        plansMount.innerHTML = plansHTML();
        wireButtons();
      });
    });
  }

  plansMount.innerHTML = plansHTML();
  wireButtons();
}
