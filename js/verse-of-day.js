// verse-of-day.js — a different verse every day, the same for everyone, never repeating until all have been used.
//
// The verses (data/verses.json) are shuffled into a fixed "random" order; each day shows the next one. When the whole
// list has been shown it is shuffled again (and a verse is never shown two days running). The order depends only on the
// date, so everyone in the church sees the same verse on the same day. A verse a pastor or admin posts for TODAY in the
// dashboard takes the place of the automatic one for that day only.
import { bibleHref, parseReference } from "./bible-link.js";

const SALT = 0x5eed1e;

/** Whole days since 1970 for the date on the person's own calendar (so it changes at THEIR midnight). */
export function dayNumber(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

/** A small repeatable random-number maker (the same seed always gives the same numbers). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const orders = new Map();

/** The order verses are shown in during one pass through the list (every position used exactly once). */
export function cycleOrder(length, cycle) {
  const key = `${length}:${cycle}`;
  if (orders.has(key)) return orders.get(key);
  const order = Array.from({ length }, (_, i) => i);
  const random = mulberry32(SALT ^ Math.imul(cycle + 1, 2654435761));
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // the last verse of one pass is never the first of the next
  if (cycle > 0 && length > 1 && order[0] === cycleOrder(length, cycle - 1)[length - 1]) [order[0], order[1]] = [order[1], order[0]];
  orders.set(key, order);
  return order;
}

/** Which verse of the list is today's. */
export function verseIndexForDay(day, length) {
  if (!length) return -1;
  return cycleOrder(length, Math.floor(day / length))[((day % length) + length) % length];
}

export function verseForDate(list, date = new Date()) {
  const i = verseIndexForDay(dayNumber(date), (list || []).length);
  return i < 0 ? null : list[i];
}

const ymd = (date) => date.toLocaleDateString("en-CA");

/**
 * What to show on Home. Returns { text, reference, label, link, source } where link is where tapping goes (or null).
 *   verses     the list from data/verses.json (may be missing if it couldn't load)
 *   posted     the latest verse row from the dashboard (counts only when it is dated TODAY)
 *   fallback   the verse to show if nothing else is available
 *   version    the Bible version this person reads ("web" shows the WEB text; anything else the KJV)
 */
export function chooseVerse({ verses, posted, fallback, version, date = new Date() }) {
  if (posted && posted.text && posted.reference && posted.verse_date === ymd(date)) {
    const target = parseReference(posted.reference);
    return { text: posted.text, reference: posted.reference, label: "", link: target ? bibleHref(target) : null, target, source: "church" };
  }
  const v = verseForDate(verses, date);
  if (v) {
    const web = version === "web";
    return { text: web ? v.web : v.kjv, reference: v.ref, label: web ? "WEB" : "KJV", link: bibleHref(v), target: { book: v.book, chapter: v.chapter, verse: v.verse, end: v.end || null }, source: "daily" };
  }
  const target = fallback ? parseReference(fallback.reference) : null;
  return { text: fallback.text, reference: fallback.reference, label: "", link: target ? bibleHref(target) : null, target, source: "fallback" };
}
