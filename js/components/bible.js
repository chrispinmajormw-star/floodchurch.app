// components/bible.js — full-page KJV reader (book/chapter picker, drop-cap
// chapter numeral, floating prev/next) plus Daily Reading and Reading Plans
// tucked behind icon buttons as bottom-sheet modals.
import { bootApp, loadData } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { BIBLE_BOOKS } from "../bible-books.js";

const STEP = 5; // percent added each time "Mark today's reading" is tapped
const LAST_READ_KEY = "flood-bible-last";
const BIBLE_API = "https://bible-api.com";

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
      const res = await fetch(`${BIBLE_API}/${encodeURIComponent(`${bookName} ${chapter}`)}?translation=kjv`);
      if (!res.ok) throw new Error("Couldn't find that passage.");
      const data = await res.json();
      if (!data.verses || !data.verses.length) throw new Error("No text found for that passage.");

      statusEl.textContent = "";
      renderVerses(data.verses, chapter);
      localStorage.setItem(LAST_READ_KEY, JSON.stringify({ book: bookName, chapter }));
    } catch (err) {
      statusEl.textContent = `Couldn't load that passage — check your connection and try again. (${err.message})`;
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
  searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const query = searchInput.value.trim();
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
    fetch(`${BIBLE_API}/${encodeURIComponent(query)}?translation=kjv`)
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
      })
      .catch((err) => {
        statusEl.textContent = `${err.message} Try a format like "John 3:16" or "Psalm 23".`;
      });
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
}

export async function renderBible() {
  const authUser = await requireAuth();
  if (!authUser) return;

  bootApp({}); // no page topbar on this page, but still applies theme + bottom nav

  wireModals();
  initBibleReader();

  const [data, progressRes] = await Promise.all([
    loadData("data/bible.json"),
    supabase.from("reading_plan_progress").select("*").eq("user_id", authUser.id),
  ]);

  const progressByTitle = {};
  (progressRes.data || []).forEach((row) => {
    progressByTitle[row.plan_title] = row.percent;
  });

  document.getElementById("daily-text").textContent = data.dailyReading.text;
  document.getElementById("daily-ref").textContent = data.dailyReading.reference;

  const plansMount = document.getElementById("plans");

  function plansHTML() {
    return data.readingPlans
      .map((plan) => {
        const percent = progressByTitle[plan.title] ?? plan.percent;
        return `
      <div class="plan-card">
        <div class="plan-top">
          <b>${plan.title}</b>
          <span>${plan.duration}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        <div class="plan-top" style="margin-top:8px; margin-bottom:0;">
          <span class="plan-percent">${percent}% complete</span>
          <button class="chip" data-plan="${plan.title}" style="padding:6px 12px;">Mark today's reading</button>
        </div>
      </div>`;
      })
      .join("");
  }

  function wireButtons() {
    plansMount.querySelectorAll("[data-plan]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const title = btn.dataset.plan;
        const current = progressByTitle[title] ?? data.readingPlans.find((p) => p.title === title).percent;
        const next = Math.min(100, current + STEP);

        btn.disabled = true;
        const { error } = await supabase
          .from("reading_plan_progress")
          .upsert(
            { user_id: authUser.id, plan_title: title, percent: next, updated_at: new Date().toISOString() },
            { onConflict: "user_id,plan_title" }
          );
        btn.disabled = false;

        if (error) {
          alert(`Couldn't save progress: ${error.message}`);
          return;
        }
        progressByTitle[title] = next;
        plansMount.innerHTML = plansHTML();
        wireButtons();
      });
    });
  }

  plansMount.innerHTML = plansHTML();
  wireButtons();
}
