// emoji-picker.js — the emoji panel for chat, and a few helpers.
//
// A hand-picked set (only emoji that show properly on older phones too), in groups, with a "Recent" tab that
// remembers what this phone used last. A message that is just 1 to 3 emoji is shown large, like a messaging app.
import { ICONS } from "./icons.js";

export const EMOJI_GROUPS = [
  { id: "smileys", label: "Smileys", glyph: "😀", emojis: "😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😋 😛 😜 🤪 🤗 🤭 🤔 🤐 😐 😑 😶 🙄 😏 😬 😌 😔 😪 😴 😷 🤒 🤕 🥵 🥶 😵 🥳 😎 🤓 😕 😟 🙁 😮 😲 😳 🥺 😢 😭 😱 😖 😞 😓 😩 😫 😤 😡".split(" ") },
  { id: "hands", label: "Hands and people", glyph: "🙏", emojis: "🙏 🙌 👏 🤲 👍 👎 👌 ✌️ 🤞 🤟 🤘 👋 🤚 ✋ 🖐️ 👆 👇 👉 👈 💪 🤝 ✍️ 👀 🧎 🚶 🏃 👪 👶 👦 👧 👨 👩 👴 👵".split(" ") },
  { id: "hearts", label: "Hearts and symbols", glyph: "❤️", emojis: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 ✨ 🌟 ⭐ 🔥 💥 💫 ✅ ❌ ⚠️ ❗ ❓ 💡 📌".split(" ") },
  { id: "faith", label: "Faith and worship", glyph: "⛪", emojis: "⛪ ✝️ 🕊️ 📖 📜 🛐 🕯️ 👑 🌈 🙏 ☀️ 🌅 🌍 🎵 🎶 🎤 🎸 🥁 🎹 🔔 🍞 🍷 🐑 🐟 🌾 🌱 🌿 💧 ⚓".split(" ") },
  { id: "nature", label: "Nature", glyph: "🌿", emojis: "🌞 ☀️ 🌤️ ⛅ 🌧️ ⛈️ 🌈 🌸 🌺 🌻 🌹 🌷 🌳 🌴 🍃 🍀 🐑 🐦 🦁 🐘 🐶 🐱 🌙 ❄️ 🌊".split(" ") },
  { id: "celebrate", label: "Celebrate and food", glyph: "🎉", emojis: "🎉 🎊 🎁 🎂 🥳 🎈 🍰 ☕ 🍞 🍚 🍲 🍎 🍌 🍉 🍇 🥭 🌽 🥕 🍗 🥤 🏆 🥇 ⚽ 🏀".split(" ") },
  { id: "things", label: "Places and things", glyph: "📍", emojis: "🏠 ⛪ 🚗 🚌 🚲 ✈️ 📍 🗓️ 📅 ⏰ 📞 📱 💻 📷 🎥 📣 📢 📚 ✏️ 📎 🔑 💰 🎒".split(" ") },
];

const RECENT_KEY = "flood-emoji-recent";
const RECENT_MAX = 24;

/** The emoji this phone used most recently (newest first). */
export function recentEmoji() {
  try {
    const list = JSON.parse(globalThis.localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter((e) => typeof e === "string").slice(0, RECENT_MAX) : [];
  } catch (e) {
    return [];
  }
}

/** Remembers an emoji as "recent" (no repeats, newest first). */
export function rememberEmoji(emoji) {
  const next = [emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    globalThis.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch (e) {
    /* it just won't be remembered */
  }
  return next;
}

/** The panel: a row of tabs and the emoji of the chosen tab. Everything is a real button (works with a keyboard and screen readers). */
export function emojiPanelHTML(active) {
  const recent = recentEmoji();
  const current = active === "recent" && !recent.length ? "smileys" : active || (recent.length ? "recent" : "smileys");
  const group = current === "recent" ? { label: "Recently used", emojis: recent } : EMOJI_GROUPS.find((g) => g.id === current) || EMOJI_GROUPS[0];
  const tab = (id, label, glyph) => `<button type="button" class="emoji-tab${id === current ? " active" : ""}" role="tab" aria-selected="${id === current}" aria-label="${label}" data-emoji-tab="${id}">${glyph}</button>`;
  return `
    <div class="emoji-tabs" role="tablist">
      ${recent.length ? tab("recent", "Recently used", ICONS.clock) : ""}
      ${EMOJI_GROUPS.map((g) => tab(g.id, g.label, g.glyph)).join("")}
    </div>
    <p class="emoji-title">${group.label}</p>
    <div class="emoji-grid" role="group" aria-label="${group.label}">
      ${group.emojis.map((e) => `<button type="button" class="emoji-btn" data-emoji="${e}" aria-label="${e}">${e}</button>`).join("")}
    </div>`;
}

/** Puts text where the cursor is in a text box (replacing anything selected) and leaves the cursor after it. */
export function insertAtCursor(box, text) {
  const start = typeof box.selectionStart === "number" ? box.selectionStart : box.value.length;
  const end = typeof box.selectionEnd === "number" ? box.selectionEnd : start;
  box.value = box.value.slice(0, start) + text + box.value.slice(end);
  const at = start + text.length;
  if (box.setSelectionRange) box.setSelectionRange(at, at);
  return box.value;
}

const ONE_EMOJI = String.raw`(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|\u20E3|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*)*`;

/** 1 to 3 if the text is only that many emoji (spaces allowed), otherwise 0. Those messages are shown large. */
export function emojiOnlyCount(text) {
  const t = String(text || "");
  if (!t.trim()) return 0;
  if (t.replace(new RegExp(ONE_EMOJI, "gu"), "").replace(/\s/g, "")) return 0;
  const n = [...t.matchAll(new RegExp(ONE_EMOJI, "gu"))].length;
  return n >= 1 && n <= 3 ? n : 0;
}
