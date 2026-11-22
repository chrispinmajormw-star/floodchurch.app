// components/bible.js — full-page Bible reader (book/chapter picker, version picker, drop-cap
// chapter numeral, floating prev/next) plus Daily Reading and Reading Plans
// tucked behind icon buttons as bottom-sheet modals.
//   • The Bible text is hosted in this app (data/<version>/…, see js/bible-text.js), so it
//     loads fast, never depends on an outside service, and works offline once opened.
//   • The search box understands references ("John 3:16", "rom 8:1-4", "psalm 23")
//     AND plain words ("love one another").
//   • Daily Reading shows the latest Verse of the Day and Today's Devotion
//     posted from the dashboard.
//   • Reading Plans come from the reading_plans table; progress is real
//     (days completed, one tap per day) and saved per member.
import { bootApp, loadData } from "../App.js";
import { ICONS } from "../icons.js";
import { getViewer, loginUrl } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { BIBLE_BOOKS } from "../bible-books.js";
import { escapeHtml } from "../util.js";
import {
  getChapter,
  getVerses,
  parseReference,
  searchText,
  splitForHighlight,
  BIBLE_VERSIONS,
  LINKED_VERSIONS,
  linkedChapterUrl,
  getVersion,
  setVersion,
  versionInfo,
  savedBookCount,
} from "../bible-text.js";

const LAST_READ_KEY = "flood-bible-last";
const SEARCH_LIMIT = 50;

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
  const versionLabel = document.getElementById("version-label");
  const versionList = document.getElementById("version-list");

  // Which version this phone reads (remembered), and how to redraw what's on screen when it changes.
  let version = getVersion();
  versionLabel.textContent = versionInfo(version).abbr;
  let view = null;

  bookSelect.innerHTML = BIBLE_BOOKS.map((b) => `<option value="${b.name}">${b.name}</option>`).join("");

  // Only the most recent request may draw on the screen (a slow earlier one is ignored).
  let currentRequest = 0;

  function populateChapters(bookName, selected) {
    const book = BIBLE_BOOKS.find((b) => b.name === bookName);
    const count = book ? book.chapters : 1;
    chapterSelect.innerHTML = Array.from({ length: count }, (_, i) => i + 1)
      .map((n) => `<option value="${n}">${n}</option>`)
      .join("");
    chapterSelect.value = selected || 1;
  }

  function selectPassage(bookName, chapter) {
    bookSelect.value = bookName;
    populateChapters(bookName, chapter);
  }

  function showError(message, retry) {
    // A version that isn't saved on this phone can't load without a signal: offer the way back to the KJV.
    const toKjv = version !== "kjv" ? '<button class="chip" id="use-kjv" style="padding:4px 10px;margin-left:6px;">Use the KJV</button>' : "";
    statusEl.innerHTML = `${escapeHtml(message)} ${retry ? '<button class="chip" id="retry-load" style="padding:4px 10px;margin-left:6px;">Try again</button>' : ""}${toKjv}`;
    const retryBtn = document.getElementById("retry-load");
    if (retryBtn && retry) retryBtn.addEventListener("click", retry);
    const kjvBtn = document.getElementById("use-kjv");
    if (kjvBtn) kjvBtn.addEventListener("click", () => chooseVersion("kjv"));
  }

  // ---- Bible version -------------------------------------------------------------------------
  /** The list in the "Bible version" sheet; `saved` (how many books are on this phone) adds a "Saved offline" note. */
  function renderVersionList(saved = null) {
    // Copyrighted versions (the NIV) come first. They open on Bible Gateway, because their text can't be kept in the app.
    const linked = LINKED_VERSIONS.map(
      (v) => `<button class="version-item version-link" data-linked="${escapeHtml(v.id)}">
        <span class="v-name"><b>${escapeHtml(v.abbr)}</b>${escapeHtml(v.name)}</span>
        <span class="v-side"><span class="v-badge v-badge-link">${ICONS.external}Bible Gateway</span></span>
        <span class="v-about">${escapeHtml(v.about)}</span>
      </button>`
    ).join("");
    const heading = linked ? '<p class="version-heading">Saved in this app (works offline)</p>' : "";
    versionList.innerHTML = linked + heading + BIBLE_VERSIONS.map((v, i) => {
      const onPhone = saved && saved[i] >= BIBLE_BOOKS.length;
      return `<button class="version-item${v.id === version ? " active" : ""}" data-version="${v.id}" aria-pressed="${v.id === version}">
        <span class="v-name"><b>${escapeHtml(v.abbr)}</b>${escapeHtml(v.name)}</span>
        <span class="v-side">${v.id === version ? `<span class="v-check">${ICONS.check}</span>` : onPhone ? '<span class="v-badge">Saved offline</span>' : ""}</span>
        <span class="v-about">${escapeHtml(v.about)}</span>
      </button>`;
    }).join("");
  }

  async function openVersionPicker() {
    renderVersionList();
    openModal("version-modal");
    const saved = await Promise.all(BIBLE_VERSIONS.map((v) => savedBookCount(v.id)));
    renderVersionList(saved); // the "Saved offline" notes appear a moment later
  }

  /** Switches the Bible version and redraws whatever is on screen (chapter, verses or search) in it. */
  function chooseVersion(id) {
    closeModal("version-modal");
    if (id === version) return;
    version = setVersion(id);
    versionLabel.textContent = versionInfo(version).abbr;
    if (view) view();
  }

  function beginLoading(title, { banner = null } = {}) {
    const id = ++currentRequest;
    statusEl.textContent = "Loading…";
    textMount.innerHTML = "";
    titleEl.textContent = title;
    bannerEl.style.display = banner ? "block" : "none";
    if (banner) bannerEl.textContent = banner.toUpperCase();
    return id;
  }

  /** A whole chapter, with the big chapter number in front of verse 1. */
  async function showChapter(bookName, chapter) {
    view = () => showChapter(bookName, chapter);
    selectPassage(bookName, chapter);
    const id = beginLoading(`${bookName} ${chapter}`, { banner: String(chapter) === "1" ? bookName : null });
    try {
      const verses = await getChapter(bookName, chapter, version);
      if (id !== currentRequest) return;
      statusEl.textContent = "";
      const [first, ...rest] = verses;
      textMount.innerHTML =
        `<span class="reader-dropcap">${chapter}</span>${escapeHtml(first.text)} ` +
        rest.map((v) => `<span class="verse-num">${v.verse}</span>${escapeHtml(v.text)} `).join("");
      localStorage.setItem(LAST_READ_KEY, JSON.stringify({ book: bookName, chapter }));
    } catch (err) {
      if (id === currentRequest) showError(err.message, () => showChapter(bookName, chapter));
    }
  }

  /** One verse or a short run of verses, with a shortcut to the full chapter. */
  async function showVerses(bookName, chapter, from, to) {
    view = () => showVerses(bookName, chapter, from, to);
    selectPassage(bookName, chapter);
    const range = to && to !== from ? `${from}\u2013${to}` : `${from}`;
    const id = beginLoading(`${bookName} ${chapter}:${range}`);
    try {
      const verses = await getVerses(bookName, chapter, from, to, version);
      if (id !== currentRequest) return;
      // Some translations leave out a few verses that older manuscripts have (e.g. Acts 8:37 in the WEB).
      statusEl.textContent = verses.length
        ? ""
        : `${bookName} ${chapter}:${range} isn\u2019t in the ${versionInfo(version).abbr}. Some translations leave out verses that the oldest manuscripts don\u2019t have.`;
      textMount.innerHTML =
        verses.map((v) => `<span class="verse-num">${v.verse}</span>${escapeHtml(v.text)} `).join("") +
        `<div style="margin-top:18px;"><button class="chip" data-open-chapter="${escapeHtml(`${bookName} ${chapter}`)}">Read all of ${escapeHtml(bookName)} ${chapter}</button></div>`;
    } catch (err) {
      if (id === currentRequest) showError(err.message, () => showVerses(bookName, chapter, from, to));
    }
  }

  /** Looks for words across the whole Bible and lists the verses that contain them. */
  async function showWordSearch(query) {
    view = () => showWordSearch(query);
    const id = beginLoading("Search");
    try {
      const { results, truncated, terms } = await searchText(query, {
        limit: SEARCH_LIMIT,
        version,
        onProgress: (done, total) => {
          if (id === currentRequest) statusEl.textContent = `Searching the ${versionInfo(version).abbr}… ${done} of ${total} books`;
        },
      });
      if (id !== currentRequest) return;
      if (!terms.length) {
        statusEl.textContent = "Type a verse like John 3:16, or at least one word to search for.";
        return;
      }
      if (!results.length) {
        statusEl.textContent = `No verses found for \u201c${query.trim()}\u201d. Try fewer or different words.`;
        return;
      }
      statusEl.textContent = truncated
        ? `Showing the first ${SEARCH_LIMIT} verses for \u201c${query.trim()}\u201d. Add more words to narrow it down.`
        : `${results.length} verse${results.length === 1 ? "" : "s"} for \u201c${query.trim()}\u201d`;
      textMount.innerHTML = results
        .map((r) => {
          const ref = `${r.book} ${r.chapter}:${r.verse}`;
          const body = splitForHighlight(r.text, terms)
            .map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
            .join("");
          return `<button class="search-hit" data-ref="${escapeHtml(ref)}"><b>${escapeHtml(ref)}</b><span>${body}</span></button>`;
        })
        .join("");
    } catch (err) {
      if (id === currentRequest) showError(err.message, () => showWordSearch(query));
    }
  }

  /** The search box: a Bible reference opens that passage; anything else is a word search. */
  function runSearch(rawQuery) {
    const query = String(rawQuery || "").trim();
    if (!query) return;
    const ref = parseReference(query);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (ref && ref.error) {
      statusEl.textContent = ref.error;
    } else if (ref && ref.verseStart) {
      showVerses(ref.book, ref.chapter, ref.verseStart, ref.verseEnd);
    } else if (ref) {
      showChapter(ref.book, ref.chapter);
    } else {
      showWordSearch(query);
    }
  }

  // Tapping a search result opens that verse; "Read all of …" opens the chapter.
  textMount.addEventListener("click", (e) => {
    const hit = e.target.closest(".search-hit");
    if (hit) return runSearch(hit.dataset.ref);
    const open = e.target.closest("[data-open-chapter]");
    if (open) {
      const ref = parseReference(open.dataset.openChapter);
      if (ref && !ref.error) showChapter(ref.book, ref.chapter);
    }
  });

  document.getElementById("version-open").addEventListener("click", openVersionPicker);
  versionList.addEventListener("click", (e) => {
    const link = e.target.closest("[data-linked]");
    if (link) {
      // e.g. the NIV: read this same chapter on Bible Gateway (the version chosen inside the app stays as it was)
      const url = linkedChapterUrl(link.dataset.linked, bookSelect.value, chapterSelect.value || 1);
      closeModal("version-modal");
      if (url) window.open(url, "_blank", "noopener");
      return;
    }
    const item = e.target.closest("[data-version]");
    if (item) chooseVersion(item.dataset.version);
  });

  bookSelect.addEventListener("change", () => {
    showChapter(bookSelect.value, 1);
    closeModal("picker-modal");
  });

  chapterSelect.addEventListener("change", () => {
    showChapter(bookSelect.value, Number(chapterSelect.value));
    closeModal("picker-modal");
  });

  prevBtn.addEventListener("click", () => {
    const bookIndex = BIBLE_BOOKS.findIndex((b) => b.name === bookSelect.value);
    let chapter = parseInt(chapterSelect.value, 10) - 1;
    let targetBookIndex = bookIndex;
    if (chapter < 1) {
      if (bookIndex === 0) return; // already at Genesis 1 — nothing before it
      targetBookIndex = bookIndex - 1;
      chapter = BIBLE_BOOKS[targetBookIndex].chapters;
    }
    showChapter(BIBLE_BOOKS[targetBookIndex].name, chapter);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  nextBtn.addEventListener("click", () => {
    const bookIndex = BIBLE_BOOKS.findIndex((b) => b.name === bookSelect.value);
    const maxChapter = BIBLE_BOOKS[bookIndex].chapters;
    let chapter = parseInt(chapterSelect.value, 10) + 1;
    let targetBookIndex = bookIndex;
    if (chapter > maxChapter) {
      if (bookIndex === BIBLE_BOOKS.length - 1) return; // already at the end of Revelation
      targetBookIndex = bookIndex + 1;
      chapter = 1;
    }
    showChapter(BIBLE_BOOKS[targetBookIndex].name, chapter);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch(searchInput.value);
  });

  // Restore last-read position, or default to John 3.
  let start = { book: "John", chapter: 3 };
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_READ_KEY));
    if (saved && BIBLE_BOOKS.some((b) => b.name === saved.book)) start = saved;
  } catch (e) {}
  showChapter(start.book, Number(start.chapter));

  return { runSearch };
}

/** Today's date as YYYY-MM-DD in the member's own time zone. */
function todayISO() {
  return new Date().toLocaleDateString("en-CA");
}

export async function renderBible() {
  const authUser = await getViewer(); // null = a visitor: they can read everything, just not track plan progress

  bootApp({}); // no page topbar on this page, but still applies theme + bottom nav

  wireModals();
  const reader = initBibleReader();

  const [fallback, verseRes, devotionRes, plansRes, progressRes] = await Promise.all([
    loadData("data/bible.json").catch(() => null),
    supabase.from("verse_of_day").select("*").order("verse_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("devotions").select("*").order("devotion_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("reading_plans").select("*").order("sort_order"),
    authUser ? supabase.from("reading_plan_progress").select("*").eq("user_id", authUser.id) : Promise.resolve({ data: [] }),
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
      // "Romans 12:2 (NKJV)" → "Romans 12:2" — the reader shows it in the version this person chose.
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
        const tick = `<span class="ic-inline">${ICONS.check}</span> `;
        const label = !authUser ? "Sign in to track" : complete ? `${tick}Completed` : doneToday ? `${tick}Done for today` : "Mark today's reading";
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
          <button class="chip" data-plan="${escapeHtml(plan.title)}" ${authUser && (complete || doneToday) ? "disabled" : ""} style="padding:6px 12px;">${label}</button>
        </div>
      </div>`;
      })
      .join("");
  }

  function wireButtons() {
    plansMount.querySelectorAll("[data-plan]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!authUser) {
          location.href = loginUrl({ why: "reading-plan" }); // tracking needs an account; they come straight back here
          return;
        }
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
