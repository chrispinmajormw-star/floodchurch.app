// bible-text.js — the Bible, hosted inside this app (data/<version>/<book>.json for the KJV, WEB, BBE,
// ASV and YLT), so reading and searching never depend on an outside service and can work offline.
//   • getVersion / setVersion ..... which version this phone reads (remembered on the phone)
//   • getChapter / getVerses ...... read from one small file per book
//   • parseReference .............. understands "John 3:16", "Rom 8:1-4", "1 cor 13", "Psalm 23"
//   • searchText .................. finds words across the whole Bible
//   • saveWholeBible & friends .... keep every book on this device for offline reading
import { BIBLE_BOOKS } from "./bible-books.js";

/** Name of the browser cache that holds saved Bible books (sw.js uses the same name). */
export const BIBLE_CACHE = "flood-bible";

/** The versions the app can read. Each lives in data/<id>/<book>.json (sw.js knows the same folders). */
export const BIBLE_VERSIONS = [
  { id: "kjv", abbr: "KJV", name: "King James Version", year: 1611, about: "The classic English Bible, the one this app has always used." },
  { id: "web", abbr: "WEB", name: "World English Bible", year: 2000, about: "Modern, easy-to-read English. Uses \u201cYahweh\u201d for God\u2019s name." },
  { id: "bbe", abbr: "BBE", name: "Bible in Basic English", year: 1949, about: "Written with only about 1,000 everyday words, so it is very easy to follow." },
  { id: "asv", abbr: "ASV", name: "American Standard Version", year: 1901, about: "A careful word-for-word revision of the KJV. Uses \u201cJehovah\u201d for God\u2019s name." },
  { id: "ylt", abbr: "YLT", name: "Young\u2019s Literal Translation", year: 1898, about: "Extremely literal: keeps the original word order and tenses. Good for study." },
];
export const DEFAULT_VERSION = "kjv";
const VERSION_KEY = "flood-bible-version";

/** The details of one version (the KJV if the id isn't one we know). */
export function versionInfo(id) {
  return BIBLE_VERSIONS.find((v) => v.id === id) || BIBLE_VERSIONS[0];
}

/** The version this phone reads: whatever was chosen last, or the KJV. */
export function getVersion() {
  try {
    const id = globalThis.localStorage && globalThis.localStorage.getItem(VERSION_KEY);
    return BIBLE_VERSIONS.some((v) => v.id === id) ? id : DEFAULT_VERSION;
  } catch (e) {
    return DEFAULT_VERSION;
  }
}

/** Remembers the chosen version. An unknown id is ignored. Returns the version now in use. */
export function setVersion(id) {
  if (!BIBLE_VERSIONS.some((v) => v.id === id)) return getVersion();
  try {
    globalThis.localStorage.setItem(VERSION_KEY, id);
  } catch (e) {
    /* the choice just won't be remembered */
  }
  return id;
}

export function bookSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function bookUrl(name, version = getVersion()) {
  const rel = `data/${version}/${bookSlug(name)}.json`;
  try {
    return new URL(rel, globalThis.location ? globalThis.location.href : "http://localhost/").href;
  } catch (e) {
    return rel;
  }
}

const hasCaches = () => typeof caches !== "undefined" && caches && typeof caches.open === "function";
const memory = new Map(); // "version/book name" → { name, chapters: [[verse, …], …] }

async function fetchWithTimeout(url, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Loads one whole book (from memory, then this device's saved copy, then the network). */
export async function getBook(name, version = getVersion()) {
  const memoryKey = `${version}/${name}`;
  if (memory.has(memoryKey)) return memory.get(memoryKey);
  const url = bookUrl(name, version);

  let data = null;
  if (hasCaches()) {
    try {
      const cache = await caches.open(BIBLE_CACHE);
      const hit = await cache.match(url);
      if (hit) data = await hit.json();
    } catch (e) {
      /* fall through to the network */
    }
  }

  if (!data) {
    let res;
    try {
      res = await fetchWithTimeout(url);
    } catch (e) {
      throw new Error("Couldn't load the Bible text — check your connection and try again.");
    }
    if (!res.ok) throw new Error(`The Bible text for ${name} isn't available (error ${res.status}).`);
    if (hasCaches()) {
      try {
        const cache = await caches.open(BIBLE_CACHE);
        await cache.put(url, res.clone());
      } catch (e) {
        /* saving a copy is a bonus, never a requirement */
      }
    }
    data = await res.json();
  }

  memory.set(memoryKey, data);
  return data;
}

const hasText = (v) => typeof v.text === "string" && v.text.trim() !== "";

/**
 * Returns an array of verse objects [{ verse: 1, text: "…" }, …] for a whole chapter.
 * A verse a translation leaves out (e.g. Acts 8:37 in the WEB) is skipped; the numbers of the others stay true.
 */
export async function getChapter(name, chapter, version = getVersion()) {
  const book = await getBook(name, version);
  const verses = book.chapters[Number(chapter) - 1];
  if (!verses) throw new Error(`${name} doesn't have a chapter ${chapter}.`);
  return verses.map((text, i) => ({ verse: i + 1, text })).filter(hasText);
}

/** Returns a range of verses from one chapter (to defaults to from). Empty if that translation leaves the verse out. */
export async function getVerses(name, chapter, from, to = from, version = getVersion()) {
  const book = await getBook(name, version);
  const verses = book.chapters[Number(chapter) - 1];
  if (!verses) throw new Error(`${name} doesn't have a chapter ${chapter}.`);
  if (from > verses.length) throw new Error(`${name} ${chapter} only has ${verses.length} verses.`);
  const last = Math.min(to, verses.length);
  return verses.map((text, i) => ({ verse: i + 1, text })).filter((v) => v.verse >= from && v.verse <= last && hasText(v));
}

// ---------------------------------------------------------------------------
// Understanding what someone typed
// ---------------------------------------------------------------------------
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Short forms people commonly type, per book. (The full name is always understood too.)
const SHORT = {
  Genesis: ["gen", "ge", "gn"],
  Exodus: ["exo", "ex", "exod"],
  Leviticus: ["lev", "le", "lv"],
  Numbers: ["num", "nu", "nm", "nb"],
  Deuteronomy: ["deut", "dt", "de"],
  Joshua: ["josh", "jos", "jsh"],
  Judges: ["judg", "jdg", "jg"],
  Ruth: ["rut", "ru"],
  Ezra: ["ezr"],
  Nehemiah: ["neh", "ne"],
  Esther: ["esth", "est", "es"],
  Job: ["jb"],
  Psalms: ["psalm", "ps", "psa", "psm", "pss", "psl"],
  Proverbs: ["prov", "pro", "prv", "pr"],
  Ecclesiastes: ["eccl", "eccles", "ecc", "ec"],
  "Song of Solomon": ["songofsongs", "song", "sos", "sol", "songofsol", "canticles", "cant"],
  Isaiah: ["isa", "is"],
  Jeremiah: ["jer", "je", "jr"],
  Lamentations: ["lam", "la"],
  Ezekiel: ["ezek", "eze", "ezk"],
  Daniel: ["dan", "da", "dn"],
  Hosea: ["hos", "ho"],
  Joel: ["joe", "jl"],
  Amos: ["amo", "am"],
  Obadiah: ["obad", "oba", "ob"],
  Jonah: ["jon", "jnh"],
  Micah: ["mic", "mi"],
  Nahum: ["nah", "na"],
  Habakkuk: ["hab", "hb"],
  Zephaniah: ["zeph", "zep", "zp"],
  Haggai: ["hag", "hg"],
  Zechariah: ["zech", "zec", "zc"],
  Malachi: ["mal", "ml"],
  Matthew: ["matt", "mat", "mt"],
  Mark: ["mrk", "mar", "mk", "mr"],
  Luke: ["luk", "lk"],
  John: ["joh", "jhn", "jn"],
  Acts: ["act", "ac"],
  Romans: ["rom", "ro", "rm"],
  Galatians: ["gal", "ga"],
  Ephesians: ["eph", "ep"],
  Philippians: ["phil", "php", "pp"],
  Colossians: ["col"],
  Titus: ["tit"],
  Philemon: ["philem", "phm", "pm"],
  Hebrews: ["heb"],
  James: ["jas", "jm"],
  Jude: ["jud", "jd"],
  Revelation: ["revelations", "rev", "re"],
};
// Numbered books: the part after the number, and its short forms.
const NUMBERED = {
  Samuel: ["sam", "sa", "sm"],
  Kings: ["kgs", "ki", "kin"],
  Chronicles: ["chron", "chr", "ch"],
  Corinthians: ["cor", "co"],
  Thessalonians: ["thess", "thes", "th"],
  Timothy: ["tim", "ti"],
  Peter: ["pet", "pe", "pt"],
  John: ["jn", "jo", "joh"],
};
const ORDINALS = { 1: ["i", "first"], 2: ["ii", "second"], 3: ["iii", "third"] };

const ALIASES = (() => {
  const map = new Map();
  for (const { name } of BIBLE_BOOKS) {
    map.set(norm(name), name);
    (SHORT[name] || []).forEach((a) => map.set(a, name));
    const m = name.match(/^([1-3]) (.+)$/);
    if (m) {
      const [, n, tail] = m;
      const forms = [norm(tail), ...(NUMBERED[tail] || [])];
      for (const prefix of [n, ...ORDINALS[n]]) forms.forEach((f) => map.set(prefix + f, name));
    }
  }
  return map;
})();

/**
 * "John 3:16" → { book: "John", chapter: 3, verseStart: 16, verseEnd: 16 }
 * "Rom 8:1-4" → verses 1 to 4 · "Psalm 23" → a whole chapter · "Mark" → Mark 1.
 * Returns null when it isn't a Bible reference (so the caller can search for words instead),
 * or { error } when it IS a reference but doesn't exist (e.g. John 99).
 */
export function parseReference(input) {
  const q = String(input || "").trim().replace(/[.,;]+$/, "");
  const m = q.match(/^((?:[1-3]\s*)?[a-z][a-z .]*?)\s*(?:(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?)?$/i);
  if (!m) return null;
  const book = ALIASES.get(norm(m[1]));
  if (!book) return null;

  const chapters = BIBLE_BOOKS.find((b) => b.name === book).chapters;
  const chapter = m[2] ? Number(m[2]) : 1;
  if (chapter < 1 || chapter > chapters) return { error: `${book} has ${chapters} chapter${chapters === 1 ? "" : "s"}.` };

  const verseStart = m[3] ? Number(m[3]) : null;
  let verseEnd = m[4] ? Number(m[4]) : verseStart;
  if (verseStart && verseEnd < verseStart) verseEnd = verseStart;
  return { book, chapter, verseStart, verseEnd, hasChapter: Boolean(m[2]) };
}

// ---------------------------------------------------------------------------
// Searching for words
// ---------------------------------------------------------------------------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A word as a pattern: matches the straight (') or curly (’) apostrophe, and "ae" or the "æ" in Cæsar. */
const termPattern = (t) => escapeRe(t).replace(/'/g, "['\u2019]").replace(/ae/g, "(?:ae|\u00e6)");

/** Splits a query into the words to look for (every word must appear in a verse). */
export function searchTerms(query) {
  return String(query || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length >= 2);
}

/**
 * Finds verses containing ALL the words (each matched from the start of a word, so
 * "love" also finds "loved" and "lovingkindness"). Results come back in Bible order.
 * onProgress(booksDone, totalBooks) lets the screen show how far along it is.
 */
export async function searchText(query, { limit = 50, onProgress, version = getVersion() } = {}) {
  const terms = searchTerms(query);
  if (!terms.length) return { results: [], truncated: false, terms };
  const regexes = terms.map((t) => new RegExp("\\b" + termPattern(t), "i"));

  const results = [];
  const BATCH = 6;
  for (let i = 0; i < BIBLE_BOOKS.length; i += BATCH) {
    const group = BIBLE_BOOKS.slice(i, i + BATCH);
    const books = await Promise.all(group.map((b) => getBook(b.name, version)));
    for (let b = 0; b < books.length; b++) {
      books[b].chapters.forEach((verses, ci) => {
        verses.forEach((text, vi) => {
          if (results.length <= limit && regexes.every((re) => re.test(text))) {
            results.push({ book: group[b].name, chapter: ci + 1, verse: vi + 1, text });
          }
        });
      });
    }
    if (onProgress) onProgress(Math.min(i + BATCH, BIBLE_BOOKS.length), BIBLE_BOOKS.length);
    if (results.length > limit) break; // plenty to show — stop reading more books
  }
  const truncated = results.length > limit;
  return { results: results.slice(0, limit), truncated, terms };
}

/** Splits text into [plain, match, plain, match, …] so matches can be highlighted safely. */
export function splitForHighlight(text, terms) {
  if (!terms || !terms.length) return [text];
  const re = new RegExp("(" + terms.map((t) => "\\b" + termPattern(t) + "\\w*").join("|") + ")", "gi");
  return text.split(re);
}

// ---------------------------------------------------------------------------
// Keeping the Bible on this device
// ---------------------------------------------------------------------------
/** How many of the 66 books of one version are saved on this device. */
export async function savedBookCount(version = getVersion()) {
  if (!hasCaches()) return 0;
  try {
    const cache = await caches.open(BIBLE_CACHE);
    let n = 0;
    for (const b of BIBLE_BOOKS) if (await cache.match(bookUrl(b.name, version))) n++;
    return n;
  } catch (e) {
    return 0;
  }
}

/** Downloads every book of one version into this device's storage. onProgress(done, total). */
export async function saveWholeBible(onProgress, version = getVersion()) {
  if (!hasCaches()) throw new Error("This browser can't save files for offline use.");
  const cache = await caches.open(BIBLE_CACHE);
  const total = BIBLE_BOOKS.length;
  let done = 0;
  const BATCH = 4;
  for (let i = 0; i < total; i += BATCH) {
    await Promise.all(
      BIBLE_BOOKS.slice(i, i + BATCH).map(async (b) => {
        const url = bookUrl(b.name, version);
        if (!(await cache.match(url))) {
          const res = await fetchWithTimeout(url, 30000);
          if (!res.ok) throw new Error(`Couldn't download ${b.name} (error ${res.status}).`);
          await cache.put(url, res);
        }
        done++;
        if (onProgress) onProgress(done, total);
      })
    );
  }
  return total;
}

/** Removes the saved copy of ONE version (the others stay saved). */
export async function removeSavedBible(version = getVersion()) {
  if (hasCaches()) {
    try {
      const cache = await caches.open(BIBLE_CACHE);
      for (const b of BIBLE_BOOKS) await cache.delete(bookUrl(b.name, version));
    } catch (e) {
      /* nothing to remove */
    }
  }
  for (const key of [...memory.keys()]) if (key.startsWith(`${version}/`)) memory.delete(key);
}

/** Removes every saved version. */
export async function removeAllSavedBibles() {
  if (hasCaches()) await caches.delete(BIBLE_CACHE);
  memory.clear();
}
