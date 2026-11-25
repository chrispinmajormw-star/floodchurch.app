// components/growth-group.js — one Growth Group's chat (a messaging-app style screen in the Flood Church design).
//
//   • Members chat; leaders, pastors and admins can also post ANNOUNCEMENTS (highlighted cards; the latest one is pinned).
//   • Send words, emoji, pictures and documents. A picture is shrunk first so it uses little mobile data.
//   • New messages appear live for everyone in the group (and a gentle check every 20 seconds as a back-up).
//   • Your own message shows instantly and is confirmed once saved; if it can't be sent you can retry it.
//   • Tap a message for Copy / Delete (you can delete your own; leaders, pastors and admins can delete any).
//   • Tap the group's name (or the info button) for "Group info": the members, and Leave group.
// The database fills in each sender's name and the time, and enforces who may read, post and delete.
// Files are kept in a private place and opened through short-lived private links.
import { bootApp } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { ICONS } from "../icons.js";
import { escapeHtml } from "../util.js";
import { hueOf, initialOf, clockTime, layoutMessages, groupUrl, linkify } from "../growth-util.js";
import { BUCKET, ACCEPT_DOCS, attachmentPath, createFileUrls, documentInfo, formatSize, prepareAttachment } from "../growth-files.js";
import { emojiPanelHTML, emojiOnlyCount, insertAtCursor, rememberEmoji } from "../emoji-picker.js";
import { openPoster } from "../poster-viewer.js";

const PAGE = 40; // messages loaded at a time
const POLL_MS = 20000;
export const MAX_LENGTH = 2000;

/** A plain-English reason for a failed request. */
export function friendlyChatError(error, context = "") {
  const msg = String((error && error.message) || error || "");
  // the file-sharing update (SQL) hasn't been run, or the data service hasn't noticed it yet
  if (/bucket not found/i.test(msg)) return "File sharing isn't switched on yet. Ask an admin to run the file-sharing update.";
  if (/schema cache|could not find the .{0,60}column|attachment_(path|name|kind|mime|size)/i.test(msg)) return "File sharing isn't fully set up yet. Ask an admin to run the file-sharing update.";
  if (/sending messages very quickly/i.test(msg)) return "You're sending messages very quickly. Please wait a moment.";
  if (/exceeded the maximum|payload too large|too large|bigger than/i.test(msg)) return "That file is too big (10 MB is the most).";
  if (/mime type|not supported|invalid_mime/i.test(msg)) return "That kind of file can't be sent.";
  if (/row-level security|permission denied|jwt|does not belong/i.test(msg)) return context === "upload" ? "You can't send files to this group." : "You can't do that in this group.";
  if (/failed to fetch|network|load failed/i.test(msg)) return "No connection. Check your internet and try again.";
  return "Something went wrong. Please try again.";
}

/** What the page looks like while it is loading (so it is never blank). */
function skeletonHTML() {
  const bubble = (side, w) => `<div class="sk-msg sk-${side}"><span class="sk-line" style="width:${w}%"></span><span class="sk-line short"></span></div>`;
  return `
    <div class="chat-skeleton" aria-hidden="true">
      <div class="chat-header"><span class="sk-circle"></span><span class="sk-title"><span class="sk-line" style="width:55%"></span><span class="sk-line short"></span></span></div>
      <div class="chat-scroll">${bubble("l", 62)}${bubble("l", 44)}${bubble("r", 52)}${bubble("l", 70)}${bubble("r", 38)}</div>
    </div>`;
}

export async function renderGrowthGroup() {
  const root = document.getElementById("chat-root");
  root.innerHTML = skeletonHTML();
  const user = await requireAuth();
  if (!user) return;
  bootApp({ back: true, backHref: "growth.html", rightIcon: null, title: "" }); // (the chat draws its own header)
  const gid = new URLSearchParams(location.search).get("id");

  const notFound = (text = "We couldn’t find that group. It may have been removed.") => {
    root.innerHTML = `<div class="chat-state"><span class="state-icon">${ICONS.users}</span><h1 class="page-title">Not found</h1><p class="page-sub">${escapeHtml(text)}</p><a class="btn btn-primary" href="growth.html">Back to Growth Groups</a></div>`;
  };
  if (!gid) return notFound();

  // ------------------------------------------------------------------ what we know
  const files = createFileUrls(supabase);
  const st = {
    group: null, place: "", role: null, staff: false, me: { id: user.id, name: "" }, messages: [], hasMore: false, members: [], announce: false,
    firstUnreadId: null, unseen: 0, sheetOpen: false, lastServerAt: null, channel: null, pollTimer: null, readTimer: null, noteTimer: null, tmp: 0,
    tray: null, preparing: false, panel: null, emojiTab: null, localByPath: new Map(),
  };
  const isMember = () => st.role !== null;
  const isLeader = () => st.role === "leader";
  const canAnnounce = () => isLeader() || st.staff;
  const canChat = () => isMember();
  const canDelete = (m) => m.user_id === st.me.id || isLeader() || st.staff;

  // Everything the chat needs is asked for AT THE SAME TIME (one round trip, not four one after another): the group, who
  // you are in it, your profile, the place names, the latest messages and the members. (The database only ever returns
  // messages to people in the group, so asking before we know your role is safe.)
  let loaded;
  try {
    loaded = await Promise.all([
      supabase.from("growth_groups").select("*").eq("id", gid).maybeSingle(),
      supabase.from("growth_members").select("role, last_read_at").eq("group_id", gid).eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("name, is_admin, is_pastor").eq("id", user.id).maybeSingle(),
      supabase.from("growth_locations").select("id, name"),
      supabase.from("growth_messages").select("*").eq("group_id", gid).order("created_at", { ascending: false }).limit(PAGE + 1),
      supabase.rpc("growth_member_list", { gid }),
    ]);
  } catch (e) {
    root.innerHTML = `<div class="chat-state"><span class="state-icon">${ICONS.users}</span><p class="page-sub">Couldn't open this group. Check your connection and try again.</p><button class="btn btn-primary" id="chat-retry">Try again</button></div>`;
    document.getElementById("chat-retry").addEventListener("click", () => location.reload());
    return;
  }
  const [groupRes, memberRes, profileRes, placesRes, msgRes, memberList] = loaded;
  if (!groupRes.data) return notFound();
  st.group = groupRes.data;
  st.role = memberRes.data ? memberRes.data.role : null;
  st.staff = Boolean(profileRes.data?.is_admin || profileRes.data?.is_pastor);
  st.me.name = profileRes.data?.name || "";
  const lastReadAt = memberRes.data ? memberRes.data.last_read_at : null;
  const here = (placesRes.data || []).find((l) => l.id === st.group.location_id);
  st.place = here ? here.name : "";

  // ------------------------------------------------------------------ not in this group (and not a pastor / admin): offer to join
  if (!isMember() && !st.staff) {
    root.innerHTML = `
      <div class="chat-state join-state">
        <span class="avatar avatar-xl" style="--hue:${hueOf(st.group.name)}" aria-hidden="true">${escapeHtml(initialOf(st.group.name))}</span>
        <h1 class="page-title">${escapeHtml(st.group.name)}</h1>
        <p class="page-sub">${ICONS.pin} ${escapeHtml(st.place)}</p>
        ${st.group.description ? `<p class="join-desc">${escapeHtml(st.group.description)}</p>` : ""}
        <p class="join-note">Join this group to read and write messages and get its announcements.</p>
        <p class="growth-notice" id="join-error" role="alert" hidden></p>
        <button class="btn btn-primary" id="join-btn">Join this group</button>
        <a class="join-back" href="growth.html">Back to Growth Groups</a>
      </div>`;
    document.getElementById("join-btn").addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Joining…";
      const { error } = await supabase.from("growth_members").insert({ group_id: gid, user_id: user.id });
      if (error && error.code !== "23505") {
        const el = document.getElementById("join-error");
        el.textContent = friendlyChatError(error);
        el.hidden = false;
        e.target.disabled = false;
        e.target.textContent = "Join this group";
        return;
      }
      location.href = groupUrl(gid);
    });
    return;
  }

  // ------------------------------------------------------------------ the screen
  root.innerHTML = `
    <header class="chat-header">
      <a class="chat-back" href="growth.html" aria-label="Back to Growth Groups">${ICONS.back}</a>
      <button type="button" class="chat-title" id="chat-info-btn" aria-label="Group info">
        <span class="avatar avatar-lg" style="--hue:${hueOf(st.group.name)}" aria-hidden="true">${escapeHtml(initialOf(st.group.name))}</span>
        <span class="chat-title-text"><b id="chat-name">${escapeHtml(st.group.name)}</b><span id="chat-sub"></span></span>
      </button>
      <button type="button" class="chat-info-icon" id="chat-info-icon" aria-label="Group info">${ICONS.info}</button>
    </header>
    <button type="button" class="pinned" id="chat-pinned" hidden></button>
    <div class="chat-scroll" id="chat-scroll" role="log" aria-live="polite" aria-label="Messages">
      <button type="button" class="chat-older" id="chat-older" hidden>Load earlier messages</button>
      <div id="chat-messages"></div>
      <div class="chat-empty" id="chat-empty" hidden><span class="state-icon">${ICONS.comment}</span><p>No messages yet. Say hello to your group!</p></div>
    </div>
    <button type="button" class="chat-jump" id="chat-jump" aria-label="Go to the latest messages" hidden>${ICONS.arrowdown}<span id="chat-jump-label"></span></button>
    <p class="chat-note" id="chat-note" role="status" aria-live="polite"></p>
    <div id="chat-footer"></div>`;
  const $ = (id) => document.getElementById(id);
  const scrollEl = $("chat-scroll");

  function setSub() {
    const n = st.members.length;
    const parts = [];
    if (st.place) parts.push(st.place);
    if (n) parts.push(`${n} ${n === 1 ? "member" : "members"}`);
    if (!isMember() && st.staff) parts.push("viewing as staff");
    $("chat-sub").textContent = parts.join(" · ");
  }

  function note(text) {
    const el = $("chat-note");
    el.textContent = text;
    clearTimeout(st.noteTimer);
    if (text) st.noteTimer = setTimeout(() => (el.textContent = ""), 4000);
  }

  // ------------------------------------------------------------------ drawing the messages
  const nearBottom = () => scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 140;
  const toBottom = () => {
    scrollEl.scrollTop = scrollEl.scrollHeight;
  };

  function actionsHTML(m) {
    const del = canDelete(m) && m._state !== "failed";
    return `<div class="msg-actions">${m.body ? '<button type="button" data-act="copy">Copy</button>' : ""}${m.attachment_path && m.attachment_kind === "file" ? '<button type="button" data-act="open-file">Download</button>' : ""}${del ? '<button type="button" data-act="delete" class="danger">Delete</button>' : ""}</div>`;
  }

  /** The picture or document inside a message. */
  function attachmentHTML(m) {
    if (!m.attachment_kind) return "";
    if (m.attachment_kind === "image") {
      const src = m._localUrl || st.localByPath.get(m.attachment_path) || files.peek(m.attachment_path);
      return `<button type="button" class="msg-image${src ? "" : " loading"}${m._state === "sending" ? " uploading" : ""}" data-act="view-image" aria-label="Open the picture"><img class="msg-img" alt="${escapeHtml(m.attachment_name || "Picture")}" data-path="${escapeHtml(m.attachment_path || "")}"${src ? ` src="${escapeHtml(src)}"` : ""} loading="lazy" decoding="async"></button>`;
    }
    const info = documentInfo(m.attachment_name);
    return `<button type="button" class="msg-file" data-act="open-file" aria-label="Open ${escapeHtml(m.attachment_name)}">
      <span class="file-icon tone-${info.tone}">${escapeHtml(info.label)}</span>
      <span class="file-info"><b>${escapeHtml(m.attachment_name)}</b><span>${escapeHtml(info.label)} · ${escapeHtml(formatSize(m.attachment_size))}</span></span>
      <span class="file-dl">${ICONS.download}</span>
    </button>`;
  }

  function itemHTML(item) {
    if (item.type === "day") return `<div class="chat-day"><span>${escapeHtml(item.label)}</span></div>`;
    const m = item.message;
    const mine = m.user_id === st.me.id;
    const unreadMark = m.id === st.firstUnreadId ? `<div class="chat-unread"><span>New messages</span></div>` : "";
    const text = m.body ? `<p class="${m.kind === "announcement" ? "announcement-text" : "msg-text"}">${linkify(escapeHtml(m.body))}</p>` : "";
    if (m.kind === "announcement") {
      return `${unreadMark}
        <article class="announcement" data-id="${escapeHtml(m.id)}">
          <header>${ICONS.megaphone}<b>Announcement</b><span>${escapeHtml(m.author_name || "Leader")} · ${escapeHtml(clockTime(m.created_at))}</span></header>
          ${attachmentHTML(m)}${text}
          ${actionsHTML(m)}
        </article>`;
    }
    const big = !m.attachment_kind && emojiOnlyCount(m.body);
    const status = m._state === "sending" ? `<span class="msg-status" aria-label="Sending">${ICONS.clock}</span>` : m._state === "failed" ? `<span class="msg-status failed" aria-label="Not sent">!</span>` : mine ? `<span class="msg-status" aria-label="Sent">${ICONS.check}</span>` : "";
    return `${unreadMark}
      <div class="msg ${mine ? "mine" : "theirs"}${item.startsRun ? " run-start" : ""}" data-id="${escapeHtml(m.id)}">
        ${!mine && item.startsRun ? `<span class="msg-name" style="--hue:${hueOf(m.author_name)}">${escapeHtml(m.author_name || "Member")}</span>` : ""}
        <div class="msg-bubble${big ? ` emoji-only emoji-${big}` : ""}${m.attachment_kind ? ` has-${m.attachment_kind}` : ""}">${attachmentHTML(m)}${text}<span class="msg-meta"><time datetime="${escapeHtml(m.created_at)}">${escapeHtml(clockTime(m.created_at))}</time>${status}</span></div>
        ${m._state === "failed" ? `<div class="msg-failed">Not sent. <button type="button" data-act="retry">Retry</button><button type="button" data-act="discard">Delete</button></div>` : actionsHTML(m)}
      </div>`;
  }

  /** The latest announcement stays pinned under the header, so it is never missed. */
  function drawPinned() {
    const el = $("chat-pinned");
    const latest = [...st.messages].reverse().find((m) => m.kind === "announcement" && !String(m.id).startsWith("tmp-"));
    if (!latest) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    const what = latest.body ? latest.body.replace(/\s+/g, " ").trim() : latest.attachment_kind === "image" ? "Photo" : latest.attachment_name || "Attachment";
    el.dataset.target = latest.id;
    el.innerHTML = `<span class="pinned-icon">${ICONS.megaphone}</span><span class="pinned-text"><b>Announcement</b><span>${escapeHtml(what)}</span></span><span class="chevron">${ICONS.chevron}</span>`;
    el.hidden = false;
  }

  /** Pictures get their private links in one request, then appear. */
  function hydrate() {
    const missing = [...root.querySelectorAll("img.msg-img[data-path]")].filter((i) => i.dataset.path && !i.getAttribute("src"));
    if (!missing.length) return;
    files.prefetch(missing.map((i) => i.dataset.path)).then(() => {
      for (const img of root.querySelectorAll("img.msg-img[data-path]")) {
        if (img.getAttribute("src")) continue;
        const url = files.peek(img.dataset.path);
        if (url) {
          img.src = url;
          img.closest(".msg-image")?.classList.remove("loading");
        }
      }
    });
  }

  function draw({ keepScroll = false } = {}) {
    const before = scrollEl.scrollHeight;
    const top = scrollEl.scrollTop;
    $("chat-messages").innerHTML = layoutMessages(st.messages).map(itemHTML).join("");
    $("chat-empty").hidden = st.messages.length > 0;
    $("chat-older").hidden = !st.hasMore;
    drawPinned();
    hydrate();
    if (keepScroll) scrollEl.scrollTop = top + (scrollEl.scrollHeight - before); // stay where they were reading
  }

  /** The round "latest messages" button: shown when you've scrolled up, with a count when new messages arrived. */
  function updateJump() {
    const jump = $("chat-jump");
    jump.hidden = !(st.unseen > 0 || !nearBottom());
    $("chat-jump-label").textContent = st.unseen === 0 ? "" : st.unseen === 1 ? "1 new message" : `${st.unseen} new messages`;
    jump.classList.toggle("has-count", st.unseen > 0);
  }

  // ------------------------------------------------------------------ keeping track of messages
  const ids = () => new Set(st.messages.map((m) => m.id));
  const byTime = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

  function markRead() {
    if (!isMember()) return;
    clearTimeout(st.readTimer);
    st.readTimer = setTimeout(() => supabase.rpc("growth_mark_read", { gid }), 600);
  }

  /** A message from the server (live, or from the back-up check). */
  function addIncoming(m) {
    if (!m || m.group_id !== gid || ids().has(m.id)) return;
    const mine = m.user_id === st.me.id;
    if (mine) {
      const i = st.messages.findIndex((x) => x._state === "sending" && x.body === m.body && (x.attachment_path || null) === (m.attachment_path || null)); // our own message coming back: replaces the waiting copy
      if (i >= 0) st.messages.splice(i, 1);
    }
    const stick = mine || nearBottom();
    st.messages.push(m);
    st.messages.sort(byTime);
    if (!st.lastServerAt || m.created_at > st.lastServerAt) st.lastServerAt = m.created_at;
    draw();
    if (stick) {
      toBottom();
      if (!mine) markRead();
    } else {
      st.unseen += 1;
      updateJump();
    }
  }

  function removeById(id) {
    const before = st.messages.length;
    st.messages = st.messages.filter((m) => m.id !== id);
    if (st.messages.length !== before) draw();
  }

  async function poll() {
    if (!st.lastServerAt) return;
    const { data, error } = await supabase.from("growth_messages").select("*").eq("group_id", gid).gt("created_at", st.lastServerAt).order("created_at", { ascending: true });
    if (error || !data) return;
    data.forEach(addIncoming);
  }

  // ------------------------------------------------------------------ first load
  const rows = msgRes.data || [];
  st.hasMore = rows.length > PAGE;
  st.messages = rows.slice(0, PAGE).reverse();
  st.members = memberList.data || [];
  st.lastServerAt = st.messages.length ? st.messages[st.messages.length - 1].created_at : null;
  if (lastReadAt) {
    const firstNew = st.messages.find((m) => m.created_at > lastReadAt && m.user_id !== st.me.id);
    st.firstUnreadId = firstNew ? firstNew.id : null; // the "New messages" line
  }
  setSub();
  draw();
  toBottom();
  markRead();
  if (msgRes.error) note(friendlyChatError(msgRes.error));

  // ------------------------------------------------------------------ the writing area
  function footerHTML() {
    if (!canChat() && !canAnnounce()) return "";
    const announceOnly = !canChat();
    return `
      <div class="composer-area">
        <div class="chat-tray" id="chat-tray" hidden></div>
        <div class="emoji-panel" id="emoji-panel" hidden></div>
        <div class="attach-menu" id="attach-menu" role="menu" hidden>
          <button type="button" role="menuitem" data-attach="image"><span class="attach-icon tone-image">${ICONS.image}</span>Picture</button>
          <button type="button" role="menuitem" data-attach="file"><span class="attach-icon tone-file">${ICONS.file}</span>Document</button>
        </div>
        <form class="chat-composer${st.announce || announceOnly ? " announcing" : ""}" id="chat-form" autocomplete="off">
          ${canAnnounce() && canChat() ? `<button type="button" class="chat-mode" id="chat-mode" aria-pressed="${st.announce}" aria-label="Send as an announcement" title="Send as an announcement">${ICONS.megaphone}</button>` : ""}
          <div class="chat-input-wrap">
            <span class="chat-mode-label" id="chat-mode-label"${st.announce || announceOnly ? "" : " hidden"}>${ICONS.megaphone}Announcement to the whole group</span>
            <div class="chat-input-row">
              <button type="button" class="chat-icon-btn" id="chat-emoji" aria-label="Emoji" aria-expanded="false">${ICONS.smile}</button>
              <textarea id="chat-input" rows="1" maxlength="${MAX_LENGTH}" placeholder="${announceOnly ? "Write an announcement…" : "Message"}" aria-label="Write a message"></textarea>
              <button type="button" class="chat-icon-btn" id="chat-attach" aria-label="Attach a picture or document" aria-haspopup="menu" aria-expanded="false">${ICONS.paperclip}</button>
            </div>
          </div>
          <button type="submit" class="chat-send" id="chat-send" aria-label="Send" disabled>${ICONS.send}</button>
        </form>
        <input type="file" id="pick-image" accept="image/*" hidden>
        <input type="file" id="pick-doc" accept="${ACCEPT_DOCS}" hidden>
      </div>`;
  }
  $("chat-footer").innerHTML = footerHTML();
  if (!canChat() && !canAnnounce()) $("chat-footer").innerHTML = `<p class="chat-readonly">You can read this group. Join it to write messages.</p>`;

  const input = () => $("chat-input");
  const sendBtn = () => $("chat-send");
  const grow = () => {
    const t = input();
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight || 0, 130)}px`;
  };
  const refreshSend = () => {
    const t = input();
    if (!t) return;
    const words = /\S/.test(t.value);
    sendBtn().disabled = st.preparing || (!words && !st.tray) || t.value.length > MAX_LENGTH;
  };

  // --- the little windows above the message bar: emoji, attach menu, and the file waiting to be sent
  function closePanels() {
    st.panel = null;
    const e = $("emoji-panel"), a = $("attach-menu");
    if (e) e.hidden = true;
    if (a) a.hidden = true;
    if ($("chat-emoji")) $("chat-emoji").setAttribute("aria-expanded", "false");
    if ($("chat-attach")) $("chat-attach").setAttribute("aria-expanded", "false");
  }
  function togglePanel(which) {
    const was = st.panel === which;
    closePanels();
    if (was) return;
    st.panel = which;
    if (which === "emoji") {
      $("emoji-panel").innerHTML = emojiPanelHTML(st.emojiTab);
      $("emoji-panel").hidden = false;
      $("chat-emoji").setAttribute("aria-expanded", "true");
    } else {
      $("attach-menu").hidden = false;
      $("chat-attach").setAttribute("aria-expanded", "true");
    }
  }

  function renderTray() {
    const tray = $("chat-tray");
    if (!tray) return;
    const t = st.tray;
    if (!t) {
      tray.hidden = true;
      tray.innerHTML = "";
      return;
    }
    const info = documentInfo(t.name);
    tray.innerHTML = `
      <div class="tray-item">
        ${t.kind === "image" ? `<img class="tray-thumb" alt="Picture to send"${t.previewUrl ? ` src="${escapeHtml(t.previewUrl)}"` : ""}>` : `<span class="file-icon tone-${info.tone}">${escapeHtml(info.label)}</span>`}
        <span class="tray-info"><b>${escapeHtml(t.name)}</b><span>${escapeHtml(formatSize(t.size))}</span></span>
        <button type="button" class="tray-x" id="attach-remove" aria-label="Remove the attachment">${ICONS.x}</button>
      </div>`;
    tray.hidden = false;
  }

  function clearTray() {
    st.tray = null;
    renderTray();
    refreshSend();
  }

  async function pickFile(file) {
    if (!file || st.preparing) return;
    closePanels();
    st.preparing = true;
    note(file.type && file.type.startsWith("image/") ? "Getting the picture ready…" : "");
    refreshSend();
    try {
      const prepared = await prepareAttachment(file);
      const previewUrl = prepared.kind === "image" && typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(prepared.file) : null;
      st.tray = { ...prepared, previewUrl };
      note("");
      renderTray();
    } catch (err) {
      note(err.message || "That file can't be sent.");
    }
    st.preparing = false;
    refreshSend();
    if (input()) input().focus();
  }

  // ------------------------------------------------------------------ sending
  async function sendMessage(text, kind, attachment) {
    const body = text.trim();
    if (!body && !attachment) return;
    const temp = { id: `tmp-${++st.tmp}`, group_id: gid, user_id: st.me.id, author_name: st.me.name || "You", kind, body, created_at: new Date().toISOString(), _state: "sending" };
    if (attachment) {
      Object.assign(temp, { attachment_kind: attachment.kind, attachment_name: attachment.name, attachment_mime: attachment.mime, attachment_size: attachment.size, _file: attachment.file, _localUrl: attachment.previewUrl });
    }
    st.messages.push(temp);
    draw();
    toBottom();
    await deliver(temp);
  }

  async function deliver(temp) {
    temp._state = "sending";
    const fail = (error, context = "") => {
      console.error("Growth Groups: a message could not be sent", error); // (so it can be looked up if needed)
      if (st.messages.includes(temp)) temp._state = "failed";
      const reason = String((error && (error.message || error.error)) || error || "").replace(/\s+/g, " ").slice(0, 100);
      note(friendlyChatError(error, context) + (st.staff && reason ? ` [${reason}]` : "")); // pastors and admins also see the technical reason
      draw();
    };
    if (temp._file && !temp.attachment_path) {
      const path = attachmentPath(gid, st.me.id, temp.attachment_name);
      const up = await supabase.storage.from(BUCKET).upload(path, temp._file, { contentType: temp.attachment_mime, cacheControl: "3600", upsert: false });
      if (up.error) return fail(up.error, "upload");
      temp.attachment_path = path; // (kept, so a retry doesn't upload the file again)
    }
    const row = { group_id: gid, user_id: st.me.id, kind: temp.kind, body: temp.body };
    if (temp.attachment_path) Object.assign(row, { attachment_path: temp.attachment_path, attachment_name: temp.attachment_name, attachment_kind: temp.attachment_kind, attachment_mime: temp.attachment_mime, attachment_size: temp.attachment_size });
    const { data, error } = await supabase.from("growth_messages").insert(row).select().single();
    const i = st.messages.indexOf(temp);
    if (error || !data) return fail(error);
    if (temp._localUrl && data.attachment_path) st.localByPath.set(data.attachment_path, temp._localUrl); // the picture they just sent doesn't flicker
    if (i >= 0) st.messages.splice(i, 1); // the confirmed copy replaces the waiting one
    if (!ids().has(data.id)) st.messages.push(data);
    st.messages.sort(byTime);
    if (!st.lastServerAt || data.created_at > st.lastServerAt) st.lastServerAt = data.created_at;
    draw();
    toBottom();
  }

  const finePointer = () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;

  root.addEventListener("input", (e) => {
    if (e.target.id === "chat-input") {
      refreshSend();
      grow();
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.id === "chat-input" && e.key === "Enter" && !e.shiftKey && finePointer()) {
      e.preventDefault(); // on a computer, Enter sends (Shift+Enter makes a new line)
      if (!sendBtn().disabled) $("chat-form").requestSubmit ? $("chat-form").requestSubmit() : sendBtn().click();
    }
  });
  root.addEventListener("submit", (e) => {
    if (e.target.id !== "chat-form") return;
    e.preventDefault();
    const t = input();
    if (!/\S/.test(t.value) && !st.tray) return;
    if (st.preparing) return;
    const kind = !canChat() || st.announce ? "announcement" : "chat";
    const text = t.value;
    const attachment = st.tray;
    t.value = "";
    st.tray = null;
    renderTray();
    closePanels();
    refreshSend();
    grow();
    sendMessage(text, kind, attachment);
  });
  root.addEventListener("change", async (e) => {
    if (e.target.id === "pick-image" || e.target.id === "pick-doc") {
      const input = e.target;
      const file = input.files && input.files[0];
      await pickFile(file);
      input.value = ""; // so choosing the same file again still works (cleared only after the file has been read)
    }
  });
  // paste a picture straight into the message box (on a computer)
  root.addEventListener("paste", (e) => {
    const file = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
    if (e.target.id === "chat-input" && file) {
      e.preventDefault();
      pickFile(file);
    }
  });
  // a picture that can't be fetched shows a calm placeholder instead of a broken icon
  root.addEventListener(
    "error",
    (e) => {
      if (e.target.matches && e.target.matches("img.msg-img")) e.target.closest(".msg-image")?.classList.add("broken");
    },
    true
  );

  // ------------------------------------------------------------------ taps
  async function openMessageFile(m, { download }) {
    if (!m.attachment_path) return;
    if (m.attachment_kind === "image" && !download) {
      const url = await files.get(m.attachment_path);
      if (!url) return note("Couldn't open the picture. Check your connection.");
      openPoster({ url, title: m.body || m.attachment_name || "Picture" });
      return;
    }
    const url = await files.download(m.attachment_path, m.attachment_name);
    if (!url) return note("Couldn't open that file. Check your connection.");
    window.open(url, "_blank", "noopener");
  }

  root.addEventListener("click", async (e) => {
    const el = e.target;
    // closing the little windows when tapping elsewhere
    if (st.panel && !el.closest("#emoji-panel, #attach-menu, #chat-emoji, #chat-attach")) closePanels();

    if (el.closest("#chat-mode")) {
      st.announce = !st.announce;
      const form = $("chat-form");
      form.classList.toggle("announcing", st.announce);
      $("chat-mode").setAttribute("aria-pressed", String(st.announce));
      $("chat-mode-label").hidden = !st.announce;
      return;
    }
    if (el.closest("#chat-emoji")) return togglePanel("emoji");
    if (el.closest("#chat-attach")) return togglePanel("attach");
    const attach = el.closest("[data-attach]");
    if (attach) {
      closePanels();
      $(attach.dataset.attach === "image" ? "pick-image" : "pick-doc").click();
      return;
    }
    const tab = el.closest("[data-emoji-tab]");
    if (tab) {
      st.emojiTab = tab.dataset.emojiTab;
      $("emoji-panel").innerHTML = emojiPanelHTML(st.emojiTab);
      return;
    }
    const emoji = el.closest("[data-emoji]");
    if (emoji) {
      insertAtCursor(input(), emoji.dataset.emoji);
      rememberEmoji(emoji.dataset.emoji);
      refreshSend();
      grow();
      return;
    }
    if (el.closest("#attach-remove")) return clearTray();
    if (el.closest("#chat-info-btn, #chat-info-icon")) return openInfo();
    if (el.closest("#chat-pinned")) {
      const target = root.querySelector(`[data-id="${$("chat-pinned").dataset.target}"]`);
      if (target) {
        if (target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("flash");
        setTimeout(() => target.classList.remove("flash"), 1600);
      }
      return;
    }
    if (el.closest("#chat-jump")) {
      st.unseen = 0;
      toBottom();
      updateJump();
      markRead();
      return;
    }
    if (el.closest("#chat-older")) return loadOlder();

    const act = el.closest("[data-act]");
    const row = el.closest("[data-id]");
    if (act && row) {
      const m = st.messages.find((x) => x.id === row.dataset.id);
      if (!m) return;
      const what = act.dataset.act;
      if (what === "copy") {
        try {
          await navigator.clipboard.writeText(m.body);
          note("Copied");
        } catch (err) {
          window.prompt("Copy this message", m.body);
        }
      } else if (what === "view-image") {
        if (m._state === "sending" || m._state === "failed") return; // not sent yet
        openMessageFile(m, { download: false });
      } else if (what === "open-file") {
        if (m._state === "sending" || m._state === "failed") return;
        openMessageFile(m, { download: true });
      } else if (what === "delete") {
        if (!window.confirm("Delete this message for everyone?")) return;
        const { data, error } = await supabase.from("growth_messages").delete().eq("id", m.id).select();
        if (error || !data || !data.length) return note(error ? friendlyChatError(error) : "That message couldn't be deleted.");
        if (m.attachment_path) supabase.storage.from(BUCKET).remove([m.attachment_path]); // tidy up the file too (best effort)
        removeById(m.id);
      } else if (what === "retry") {
        deliver(m);
        draw();
      } else if (what === "discard") {
        st.messages = st.messages.filter((x) => x !== m);
        draw();
      }
      return;
    }
    // tapping a message opens its Copy / Delete choices (one at a time)
    const bubble = el.closest(".msg-bubble, .announcement");
    if (bubble) {
      const wrap = bubble.closest("[data-id]");
      const open = wrap.classList.contains("selected");
      root.querySelectorAll(".selected").forEach((x) => x.classList.remove("selected"));
      if (!open) wrap.classList.add("selected");
    }
  });

  async function loadOlder() {
    const first = st.messages.find((m) => !String(m.id).startsWith("tmp-"));
    if (!first) return;
    const btn = $("chat-older");
    btn.disabled = true;
    btn.textContent = "Loading…";
    const { data, error } = await supabase.from("growth_messages").select("*").eq("group_id", gid).lt("created_at", first.created_at).order("created_at", { ascending: false }).limit(PAGE + 1);
    btn.disabled = false;
    btn.textContent = "Load earlier messages";
    if (error) return note(friendlyChatError(error));
    st.hasMore = (data || []).length > PAGE;
    const older = (data || []).slice(0, PAGE).reverse();
    const have = ids();
    st.messages = [...older.filter((m) => !have.has(m.id)), ...st.messages];
    draw({ keepScroll: true });
  }

  scrollEl.addEventListener("scroll", () => {
    if (st.unseen && nearBottom()) {
      st.unseen = 0;
      markRead();
    }
    updateJump();
  });

  // ------------------------------------------------------------------ group info
  async function refreshMembers() {
    const res = await supabase.rpc("growth_member_list", { gid });
    st.members = res.data || [];
    setSub();
  }

  function sheetHTML() {
    const me = st.me.id;
    return `
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Group info">
        <div class="sheet-head"><h2 class="section-title" style="margin:0;">Group info</h2><button type="button" class="modal-close" data-sheet="close" aria-label="Close">${ICONS.x}</button></div>
        <div class="sheet-body">
          <div class="info-top">
            <span class="avatar avatar-xl" style="--hue:${hueOf(st.group.name)}" aria-hidden="true">${escapeHtml(initialOf(st.group.name))}</span>
            <h3>${escapeHtml(st.group.name)}</h3>
            <p>${ICONS.pin} ${escapeHtml(st.place)}</p>
            ${st.group.description ? `<p class="info-desc">${escapeHtml(st.group.description)}</p>` : ""}
          </div>
          <h4 class="info-heading">${st.members.length} ${st.members.length === 1 ? "member" : "members"}</h4>
          <div class="member-list">
            ${st.members
              .map((p) => {
                const self = p.user_id === me;
                const removable = !self && (st.staff || (isLeader() && p.role === "member"));
                return `
              <div class="member-row" data-user="${escapeHtml(p.user_id)}">
                <span class="avatar" style="--hue:${hueOf(p.name)}" aria-hidden="true">${escapeHtml(initialOf(p.name))}</span>
                <span class="member-name">${escapeHtml(p.name)}${self ? ' <span class="member-you">(You)</span>' : ""}</span>
                ${p.role === "leader" ? '<span class="leader-tag">Leader</span>' : ""}
                ${st.staff && !self ? `<button type="button" class="member-btn" data-sheet="${p.role === "leader" ? "demote" : "promote"}" data-user="${escapeHtml(p.user_id)}">${p.role === "leader" ? "Remove leader" : "Make leader"}</button>` : ""}
                ${removable ? `<button type="button" class="member-btn danger" data-sheet="remove" data-user="${escapeHtml(p.user_id)}">Remove</button>` : ""}
              </div>`;
              })
              .join("")}
          </div>
          <p class="growth-notice" id="sheet-notice" role="alert" hidden></p>
          ${isMember() ? '<button type="button" class="btn btn-outline leave-btn" data-sheet="leave">Leave group</button>' : ""}
        </div>
      </div>`;
  }

  async function openInfo() {
    closePanels();
    await refreshMembers();
    let overlay = $("info-sheet");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "info-sheet";
      overlay.className = "sheet-overlay";
      root.appendChild(overlay);
      overlay.addEventListener("click", async (e) => {
        if (e.target === overlay) return closeInfo();
        const b = e.target.closest("[data-sheet]");
        if (!b) return;
        const action = b.dataset.sheet;
        const user_id = b.dataset.user;
        const fail = (error) => {
          const n = $("sheet-notice");
          n.textContent = friendlyChatError(error);
          n.hidden = false;
        };
        if (action === "close") return closeInfo();
        if (action === "leave") {
          if (!window.confirm("Leave this group? You won't see its messages any more.")) return;
          const { error } = await supabase.from("growth_members").delete().eq("group_id", gid).eq("user_id", st.me.id);
          if (error) return fail(error);
          location.href = "growth.html";
        } else if (action === "promote" || action === "demote") {
          const { error } = await supabase.from("growth_members").update({ role: action === "promote" ? "leader" : "member" }).eq("group_id", gid).eq("user_id", user_id);
          if (error) return fail(error);
          await refreshMembers();
          overlay.innerHTML = sheetHTML();
        } else if (action === "remove") {
          if (!window.confirm("Remove this person from the group?")) return;
          const { data, error } = await supabase.from("growth_members").delete().eq("group_id", gid).eq("user_id", user_id).select();
          if (error || !data || !data.length) return fail(error || "Couldn't remove them.");
          await refreshMembers();
          overlay.innerHTML = sheetHTML();
        }
      });
    }
    overlay.innerHTML = sheetHTML();
    overlay.classList.add("open");
    st.sheetOpen = true;
  }

  function closeInfo() {
    const overlay = $("info-sheet");
    if (overlay) overlay.classList.remove("open");
    st.sheetOpen = false;
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (st.sheetOpen) closeInfo();
    else if (st.panel) closePanels();
  });

  // ------------------------------------------------------------------ live updates (and a back-up check)
  if (typeof supabase.channel === "function") {
    st.channel = supabase
      .channel(`growth-${gid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "growth_messages", filter: `group_id=eq.${gid}` }, (payload) => addIncoming(payload.new))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "growth_messages", filter: `group_id=eq.${gid}` }, (payload) => payload.old && removeById(payload.old.id))
      .subscribe();
  }
  st.pollTimer = setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      poll();
      markRead();
    }
  });
  window.addEventListener("pagehide", () => {
    clearInterval(st.pollTimer);
    if (st.channel && typeof supabase.removeChannel === "function") supabase.removeChannel(st.channel);
  });
}
