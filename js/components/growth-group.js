// components/growth-group.js — one Growth Group's chat (a WhatsApp-style screen in the Flood Church design).
//
//   • Members chat; leaders, pastors and admins can also post ANNOUNCEMENTS (shown as highlighted cards).
//   • New messages appear live for everyone in the group (and a gentle check every 20 seconds as a back-up).
//   • Your own message shows instantly and is confirmed once saved; if it can't be sent you can retry it.
//   • Tap a message for Copy / Delete (you can delete your own; leaders, pastors and admins can delete any).
//   • Tap the group's name for "Group info": the members, and Leave group.
// The database fills in each sender's name and the time, and enforces who may read, post and delete.
import { bootApp } from "../App.js";
import { requireAuth } from "../auth.js";
import { supabase } from "../supabaseClient.js";
import { ICONS } from "../icons.js";
import { escapeHtml } from "../util.js";
import { hueOf, initialOf, clockTime, layoutMessages, groupUrl } from "../growth-util.js";

const PAGE = 40; // messages loaded at a time
const POLL_MS = 20000;
export const MAX_LENGTH = 2000;

/** A plain-English reason for a failed request. */
export function friendlyChatError(error) {
  const msg = String((error && error.message) || error || "");
  if (/sending messages very quickly/i.test(msg)) return "You're sending messages very quickly. Please wait a moment.";
  if (/row-level security|permission denied|jwt/i.test(msg)) return "You can't do that in this group.";
  if (/failed to fetch|network|load failed/i.test(msg)) return "No connection. Check your internet and try again.";
  return "Something went wrong. Please try again.";
}

export async function renderGrowthGroup() {
  const user = await requireAuth();
  if (!user) return;
  bootApp({ back: true, backHref: "growth.html", rightIcon: null, title: "" }); // (the chat draws its own header)
  const root = document.getElementById("chat-root");
  const gid = new URLSearchParams(location.search).get("id");

  const notFound = (text = "We couldn’t find that group. It may have been removed.") => {
    root.innerHTML = `<div class="chat-state"><h1 class="page-title">Not found</h1><p class="page-sub">${escapeHtml(text)}</p><a class="btn btn-primary" href="growth.html">Back to Growth Groups</a></div>`;
  };
  if (!gid) return notFound();

  // ------------------------------------------------------------------ what we know
  const st = { group: null, place: "", role: null, staff: false, me: { id: user.id, name: "" }, messages: [], hasMore: false, members: [], announce: false, firstUnreadId: null, unseen: 0, sheetOpen: false, lastServerAt: null, channel: null, pollTimer: null, readTimer: null, noteTimer: null, tmp: 0 };
  const isMember = () => st.role !== null;
  const isLeader = () => st.role === "leader";
  const canAnnounce = () => isLeader() || st.staff;
  const canChat = () => isMember();
  const canDelete = (m) => m.user_id === st.me.id || isLeader() || st.staff;

  let loaded;
  try {
    loaded = await Promise.all([
      supabase.from("growth_groups").select("*").eq("id", gid).maybeSingle(),
      supabase.from("growth_members").select("role, last_read_at").eq("group_id", gid).eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("name, is_admin, is_pastor").eq("id", user.id).maybeSingle(),
    ]);
  } catch (e) {
    root.innerHTML = `<div class="chat-state"><p class="page-sub">Couldn't open this group. Check your connection and try again.</p><button class="btn btn-primary" id="chat-retry">Try again</button></div>`;
    document.getElementById("chat-retry").addEventListener("click", () => location.reload());
    return;
  }
  const [groupRes, memberRes, profileRes] = loaded;
  if (!groupRes.data) return notFound();
  st.group = groupRes.data;
  st.role = memberRes.data ? memberRes.data.role : null;
  st.staff = Boolean(profileRes.data?.is_admin || profileRes.data?.is_pastor);
  st.me.name = profileRes.data?.name || "";
  const lastReadAt = memberRes.data ? memberRes.data.last_read_at : null;
  const place = await supabase.from("growth_locations").select("name").eq("id", st.group.location_id).maybeSingle();
  st.place = place.data ? place.data.name : "";

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
        <span class="avatar" style="--hue:${hueOf(st.group.name)}" aria-hidden="true">${escapeHtml(initialOf(st.group.name))}</span>
        <span class="chat-title-text"><b id="chat-name">${escapeHtml(st.group.name)}</b><span id="chat-sub"></span></span>
      </button>
    </header>
    <div class="chat-scroll" id="chat-scroll" role="log" aria-live="polite" aria-label="Messages">
      <button type="button" class="chat-older" id="chat-older" hidden>Load earlier messages</button>
      <div id="chat-messages"></div>
      <p class="chat-empty" id="chat-empty" hidden>No messages yet. Say hello to your group!</p>
    </div>
    <button type="button" class="chat-jump" id="chat-jump" hidden>${ICONS.chevron}<span id="chat-jump-label"></span></button>
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
    return `<div class="msg-actions"><button type="button" data-act="copy">Copy</button>${del ? '<button type="button" data-act="delete" class="danger">Delete</button>' : ""}</div>`;
  }

  function itemHTML(item) {
    if (item.type === "day") return `<div class="chat-day"><span>${escapeHtml(item.label)}</span></div>`;
    const m = item.message;
    const mine = m.user_id === st.me.id;
    const unreadMark = m.id === st.firstUnreadId ? `<div class="chat-unread"><span>New messages</span></div>` : "";
    if (m.kind === "announcement") {
      return `${unreadMark}
        <article class="announcement" data-id="${escapeHtml(m.id)}">
          <header>${ICONS.megaphone}<b>Announcement</b><span>${escapeHtml(m.author_name || "Leader")} · ${escapeHtml(clockTime(m.created_at))}</span></header>
          <p class="announcement-text">${escapeHtml(m.body)}</p>
          ${actionsHTML(m)}
        </article>`;
    }
    const status = m._state === "sending" ? `<span class="msg-status" aria-label="Sending">${ICONS.clock}</span>` : m._state === "failed" ? `<span class="msg-status failed" aria-label="Not sent">!</span>` : mine ? `<span class="msg-status" aria-label="Sent">${ICONS.check}</span>` : "";
    return `${unreadMark}
      <div class="msg ${mine ? "mine" : "theirs"}${item.startsRun ? " run-start" : ""}" data-id="${escapeHtml(m.id)}">
        ${!mine && item.startsRun ? `<span class="msg-name" style="--hue:${hueOf(m.author_name)}">${escapeHtml(m.author_name || "Member")}</span>` : ""}
        <div class="msg-bubble"><p class="msg-text">${escapeHtml(m.body)}</p><span class="msg-meta"><time datetime="${escapeHtml(m.created_at)}">${escapeHtml(clockTime(m.created_at))}</time>${status}</span></div>
        ${m._state === "failed" ? `<div class="msg-failed">Not sent. <button type="button" data-act="retry">Retry</button><button type="button" data-act="discard">Delete</button></div>` : actionsHTML(m)}
      </div>`;
  }

  function draw({ keepScroll = false } = {}) {
    const before = scrollEl.scrollHeight;
    const top = scrollEl.scrollTop;
    $("chat-messages").innerHTML = layoutMessages(st.messages).map(itemHTML).join("");
    $("chat-empty").hidden = st.messages.length > 0;
    $("chat-older").hidden = !st.hasMore;
    if (keepScroll) scrollEl.scrollTop = top + (scrollEl.scrollHeight - before); // stay where they were reading
  }

  function updateJump() {
    const jump = $("chat-jump");
    jump.hidden = st.unseen === 0;
    $("chat-jump-label").textContent = st.unseen === 1 ? "1 new message" : `${st.unseen} new messages`;
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
      const i = st.messages.findIndex((x) => x._state === "sending" && x.body === m.body); // our own message coming back: replaces the waiting copy
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
  const msgRes = await supabase.from("growth_messages").select("*").eq("group_id", gid).order("created_at", { ascending: false }).limit(PAGE + 1);
  const memberList = await supabase.rpc("growth_member_list", { gid });
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
      <form class="chat-composer${st.announce || announceOnly ? " announcing" : ""}" id="chat-form" autocomplete="off">
        ${canAnnounce() && canChat() ? `<button type="button" class="chat-mode" id="chat-mode" aria-pressed="${st.announce}" aria-label="Send as an announcement" title="Send as an announcement">${ICONS.megaphone}</button>` : ""}
        <div class="chat-input-wrap">
          <span class="chat-mode-label" id="chat-mode-label"${st.announce || announceOnly ? "" : " hidden"}>${ICONS.megaphone}Announcement to the whole group</span>
          <textarea id="chat-input" rows="1" maxlength="${MAX_LENGTH}" placeholder="${announceOnly ? "Write an announcement…" : "Message"}" aria-label="Write a message"></textarea>
        </div>
        <button type="submit" class="chat-send" id="chat-send" aria-label="Send" disabled>${ICONS.send}</button>
      </form>`;
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
    if (t) sendBtn().disabled = !/\S/.test(t.value) || t.value.length > MAX_LENGTH;
  };

  async function sendMessage(text, kind) {
    const body = text.trim();
    if (!body) return;
    const temp = { id: `tmp-${++st.tmp}`, group_id: gid, user_id: st.me.id, author_name: st.me.name || "You", kind, body, created_at: new Date().toISOString(), _state: "sending" };
    st.messages.push(temp);
    draw();
    toBottom();
    await deliver(temp);
  }

  async function deliver(temp) {
    temp._state = "sending";
    const { data, error } = await supabase.from("growth_messages").insert({ group_id: gid, user_id: st.me.id, kind: temp.kind, body: temp.body }).select().single();
    const i = st.messages.indexOf(temp);
    if (error || !data) {
      if (i >= 0) temp._state = "failed";
      note(friendlyChatError(error));
      draw();
      return;
    }
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
    if (!/\S/.test(t.value)) return;
    const kind = !canChat() || st.announce ? "announcement" : "chat";
    const text = t.value;
    t.value = "";
    refreshSend();
    grow();
    sendMessage(text, kind);
  });

  // ------------------------------------------------------------------ taps
  root.addEventListener("click", async (e) => {
    const el = e.target;
    if (el.closest("#chat-mode")) {
      st.announce = !st.announce;
      const form = $("chat-form");
      form.classList.toggle("announcing", st.announce);
      $("chat-mode").setAttribute("aria-pressed", String(st.announce));
      $("chat-mode-label").hidden = !st.announce;
      return;
    }
    if (el.closest("#chat-info-btn")) return openInfo();
    if (el.closest("#chat-jump")) {
      st.unseen = 0;
      updateJump();
      toBottom();
      markRead();
      return;
    }
    if (el.closest("#chat-older")) return loadOlder();

    const act = el.closest("[data-act]");
    const row = el.closest("[data-id]");
    if (act && row) {
      const m = st.messages.find((x) => x.id === row.dataset.id);
      if (!m) return;
      if (act.dataset.act === "copy") {
        try {
          await navigator.clipboard.writeText(m.body);
          note("Copied");
        } catch (err) {
          window.prompt("Copy this message", m.body);
        }
      } else if (act.dataset.act === "delete") {
        if (!window.confirm("Delete this message for everyone?")) return;
        const { data, error } = await supabase.from("growth_messages").delete().eq("id", m.id).select();
        if (error || !data || !data.length) return note(error ? friendlyChatError(error) : "That message couldn't be deleted.");
        removeById(m.id);
      } else if (act.dataset.act === "retry") {
        deliver(m);
        draw();
      } else if (act.dataset.act === "discard") {
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
      updateJump();
      markRead();
    }
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
    if (e.key === "Escape" && st.sheetOpen) closeInfo();
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
