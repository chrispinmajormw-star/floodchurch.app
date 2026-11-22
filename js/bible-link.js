// bible-link.js — links INTO the Bible page ("bible.html?book=John&chapter=3&verse=16"), and the helpers behind them.
//
//   parseBibleLink(search)   reads such a link; anything invalid gives null (so a bad link just opens the Bible normally)
//   parseReference(text)     reads a typed reference like "John 3:16" or "1 Cor 13"... ("John 3:16 (NKJV)" works too)
//   bibleHref(target)        builds the link for { book, chapter, verse?, end? }
//   highlightVerses(box, from, to)   marks those verses in a drawn chapter, so the reader lands right on them
import { BIBLE_BOOKS } from "./bible-books.js";

const ALIASES = { psalm: "Psalms", "song of songs": "Song of Solomon", "songs of solomon": "Song of Solomon", "song of solomon": "Song of Solomon", revelations: "Revelation", "the revelation": "Revelation" };
const MAX_VERSE = 200;

/** "psalm", "1  john", "Song of Songs" → the app's own book name, or null. */
export function normalizeBook(name) {
  const key = String(name || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim().replace(/^([1-3])(?=[a-z])/, "$1 ");
  if (!key) return null;
  const hit = BIBLE_BOOKS.find((b) => b.name.toLowerCase() === key);
  return hit ? hit.name : ALIASES[key] || null;
}

const bookInfo = (name) => BIBLE_BOOKS.find((b) => b.name === name);

function checked(book, chapter, verse, end) {
  const info = bookInfo(book);
  if (!info || !Number.isInteger(chapter) || chapter < 1 || chapter > info.chapters) return null;
  const out = { book, chapter, verse: null, end: null };
  if (Number.isInteger(verse) && verse >= 1 && verse <= MAX_VERSE) {
    out.verse = verse;
    if (Number.isInteger(end) && end > verse && end <= MAX_VERSE) out.end = end;
  }
  return out;
}

/** A typed reference such as "John 3:16", "Psalm 23", "1 John 4:7-8". Null when it isn't one we can place in the Bible. */
export function parseReference(text) {
  const m = /^\s*((?:[1-3]\s*)?[A-Za-z][A-Za-z .]*?)\s+(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?(?!\d)/.exec(String(text || ""));
  if (!m) return null;
  const book = normalizeBook(m[1]);
  if (!book) return null;
  return checked(book, Number(m[2]), m[3] ? Number(m[3]) : null, m[4] ? Number(m[4]) : null);
}

/** Reads ?book=John&chapter=3&verse=16&to=18 → { book, chapter, verse, to } or null if it isn't a real place in the Bible. */
export function parseBibleLink(search) {
  const p = new URLSearchParams(search || "");
  const book = normalizeBook(p.get("book"));
  if (!book || !/^\d{1,3}$/.test(p.get("chapter") || "")) return null;
  const verse = /^\d{1,3}$/.test(p.get("verse") || "") ? Number(p.get("verse")) : null;
  const end = /^\d{1,3}$/.test(p.get("to") || "") ? Number(p.get("to")) : null;
  const ok = checked(book, Number(p.get("chapter")), verse, end);
  return ok ? { book: ok.book, chapter: ok.chapter, verse: ok.verse, to: ok.end } : null;
}

/** The link to open that place in the Bible. */
export function bibleHref({ book, chapter, verse = null, end = null }) {
  const q = new URLSearchParams({ book, chapter: String(chapter) });
  if (verse) q.set("verse", String(verse));
  if (verse && end && end > verse) q.set("to", String(end));
  return `bible.html?${q.toString().replace(/\+/g, "%20")}`;
}

/**
 * Marks verses `from`..`to` inside a chapter that has been drawn as
 * [big chapter number][verse 1 words] [verse number][words] [verse number][words]…
 * Returns the highlight (so the page can scroll to it), or null if those verses aren't there.
 */
export function highlightVerses(box, from, to = from) {
  const nodes = [...box.childNodes];
  const numberAt = (n) => nodes.findIndex((x) => x.nodeType === 1 && x.classList.contains("verse-num") && x.textContent.trim() === String(n));
  const start = from === 1 ? 0 : numberAt(from);
  if (start < 0 || !nodes.length) return null;
  const after = numberAt(to + 1);
  const stop = after < 0 ? nodes.length : after;
  if (stop <= start) return null;
  const mark = box.ownerDocument.createElement("mark");
  mark.className = "verse-flash";
  box.insertBefore(mark, nodes[start]);
  for (let i = start; i < stop; i++) mark.appendChild(nodes[i]);
  return mark;
}
