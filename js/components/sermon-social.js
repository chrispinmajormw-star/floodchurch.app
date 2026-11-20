// components/sermon-social.js — Love, Share and Comments under a sermon on the Watch page (like YouTube).
//
//   • Everyone, with or without an account, can READ the comments and see the totals, and can SHARE.
//   • Signed-in members can comment, reply, and Love the sermon or any comment.
//   • Someone without an account who taps Love / Comment / Reply is taken to the friendly "Sign in or create an
//     account to continue" screen and brought straight back here.
//   • A member can delete their own comment; an admin or pastor can delete any comment.
//
// The database (supabase-sermon-comments.sql) fills in each commenter's name and every count, so none of that can be faked.
import { supabase } from "../supabaseClient.js";
import { ICONS } from "../icons.js";
import { escapeHtml, timeAgo } from "../util.js";
import { loginUrl, signupUrl } from "../auth.js";

const PAGE = 20; // comments shown at a time
export const MAX_LENGTH = 1000;

/** 999 → "999", 1200 → "1.2K", 15000 → "15K", 2500000 → "2.5M" */
export function compactCount(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v < 1000) return String(v);
  const trim = (x) => (x < 10 ? String(Math.floor(x * 10) / 10) : String(Math.floor(x)));
  return v < 1_000_000 ? `${trim(v / 1000)}K` : `${trim(v / 1_000_000)}M`;
}

/** The first letter of a name, for the round picture next to a comment. */
export function initialOf(name) {
  const first = Array.from(String(name || "").trim())[0];
  return first ? first.toUpperCase() : "?";
}

/** A colour for a name (the same name always gets the same colour). */
export function hueOf(name) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

/** A plain-English reason for a failed request. */
export function friendlyError(error) {
  const msg = String((error && error.message) || error || "");
  if (/commenting very quickly/i.test(msg)) return "You're commenting very quickly. Please wait a moment and try again.";
  if (/jwt|row-level security|permission denied|not authenticated/i.test(msg)) return "Please sign in again to do that.";
  if (/failed to fetch|network|load failed|fetch/i.test(msg)) return "Couldn't reach the server. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}

/**
 * Puts the Love / Share / Comments section into `mount`. `viewer` is the signed-in member, or null for a visitor.
 * Returns { show(sermon), destroy() }; call show({ id, title }) whenever a different sermon is playing.
 */
export function mountSermonSocial(mount, { viewer = null } = {}) {
  let sermon = null;
  let token = 0; // a newer sermon makes older answers arrive too late to matter
  let st = null; // everything about the sermon on screen
  let profile = { name: "", staff: false };
  let noteTimer = null;
  let posting = false;
  const byId = new Map();

  const $ = (id) => mount.querySelector(`#${id}`);

  // ------------------------------------------------------------------ small helpers
  function note(message) {
    const el = $("social-note");
    if (!el) return;
    el.textContent = message;
    clearTimeout(noteTimer);
    if (message) noteTimer = setTimeout(() => el && (el.textContent = ""), 3500);
  }

  /** Someone without an account: explain, and bring them straight back here afterwards. */
  function goSignIn(why) {
    location.href = loginUrl({ why });
  }

  function setCountEl(el, n) {
    el.textContent = n > 0 ? compactCount(n) : "";
    el.hidden = !(n > 0);
  }

  function renderCounts() {
    const love = $("sermon-love");
    if (love) {
      love.classList.toggle("loved", st.loved);
      love.setAttribute("aria-pressed", String(st.loved));
      love.setAttribute("aria-label", `${st.loved ? "Unlove" : "Love"} this sermon${st.loves ? `, ${st.loves} ${st.loves === 1 ? "love" : "loves"}` : ""}`);
      setCountEl($("love-count"), st.loves);
    }
    setCountEl($("bar-comment-count"), st.comments);
    setCountEl($("comments-total"), st.comments);
  }

  // ------------------------------------------------------------------ comment markup
  function commentHTML(c, { reply = false } = {}) {
    const name = c.author_name || "Member";
    const mine = Boolean(viewer) && c.user_id === viewer.id;
    const canDelete = Boolean(viewer) && (mine || profile.staff);
    const loved = st.myCommentLoves.has(c.id);
    const loves = Number(c.love_count) || 0;
    return `
      <article class="comment${reply ? " is-reply" : ""}" data-id="${escapeHtml(c.id)}">
        <span class="avatar" style="--hue:${hueOf(name)}" aria-hidden="true">${escapeHtml(initialOf(name))}</span>
        <div class="comment-main">
          <p class="comment-head"><b class="comment-author">${escapeHtml(name)}</b><time class="comment-time" datetime="${escapeHtml(c.created_at)}">${escapeHtml(timeAgo(c.created_at))}</time></p>
          <p class="comment-text">${escapeHtml(c.body)}</p>
          <div class="comment-actions">
            <button type="button" class="c-love${loved ? " loved" : ""}" aria-pressed="${loved}" aria-label="Love this comment" data-count="${loves}">${ICONS.heart}<span class="c-love-count"${loves ? "" : " hidden"}>${loves ? compactCount(loves) : ""}</span></button>
            <button type="button" class="c-reply" aria-label="Reply to ${escapeHtml(name)}">Reply</button>
            ${canDelete ? `<button type="button" class="c-delete" aria-label="Delete this comment">${ICONS.trash}</button>` : ""}
          </div>
          <div class="reply-slot"></div>
          ${reply ? "" : `<div class="replies">${(st.replies.get(c.id) || []).map((r) => commentHTML(r, { reply: true })).join("")}</div>`}
        </div>
      </article>`;
  }

  function remember(list) {
    for (const c of list) byId.set(c.id, c);
  }

  function renderEmptyIfNeeded() {
    const list = $("comment-list");
    if (!list.querySelector(".comment") && !list.querySelector(".comments-status")) {
      list.innerHTML = `<p class="comments-status">No comments yet. Be the first to share what this sermon meant to you.</p>`;
    }
  }

  function renderList() {
    const list = $("comment-list");
    list.innerHTML = st.topLevel.map((c) => commentHTML(c)).join("");
    renderEmptyIfNeeded();
    $("comments-more").hidden = !st.hasMore;
  }

  // ------------------------------------------------------------------ the box for writing a comment
  function composerHTML() {
    if (!viewer) {
      return `
        <div class="composer-gate">
          <b>Join the conversation</b>
          <span>Sign in or create a free account to comment and show some love.</span>
          <div class="composer-gate-actions">
            <a class="btn btn-primary" id="gate-signup" href="${escapeHtml(signupUrl({ why: "comment" }))}">Create account</a>
            <a class="guest-link" id="gate-signin" href="${escapeHtml(loginUrl({ why: "comment" }))}">Sign in</a>
          </div>
        </div>`;
    }
    const name = profile.name || (viewer.email ? viewer.email.split("@")[0] : "");
    return `
      <form class="composer" id="comment-form" autocomplete="off">
        <span class="avatar" style="--hue:${hueOf(name)}" aria-hidden="true">${escapeHtml(initialOf(name))}</span>
        <div class="composer-main">
          <textarea id="comment-input" rows="1" maxlength="${MAX_LENGTH}" placeholder="Add a comment…" aria-label="Add a comment"></textarea>
          <div class="composer-row" id="composer-row" hidden>
            <span class="composer-count" id="composer-count"></span>
            <button type="button" class="composer-cancel" id="composer-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary composer-post" id="composer-post" disabled>Comment</button>
          </div>
          <p class="composer-error" id="composer-error" role="alert" hidden></p>
        </div>
      </form>`;
  }

  const autoGrow = (t) => {
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight || 0, 160)}px`;
  };

  /** Wires a text box + its Post button: enables Post only when there is something to post. */
  function wireBox(input, postBtn, counter) {
    const refresh = () => {
      const v = input.value;
      postBtn.disabled = posting || !/\S/.test(v) || v.length > MAX_LENGTH;
      if (counter) {
        const left = MAX_LENGTH - v.length;
        counter.textContent = left <= 100 ? `${left} left` : "";
      }
      autoGrow(input);
    };
    input.addEventListener("input", refresh);
    return refresh;
  }

  function wireComposer() {
    const form = $("comment-form");
    if (!form) return;
    const input = $("comment-input");
    const row = $("composer-row");
    const post = $("composer-post");
    const errorEl = $("composer-error");
    const refresh = wireBox(input, post, $("composer-count"));

    input.addEventListener("focus", () => (row.hidden = false));
    $("composer-cancel").addEventListener("click", () => {
      input.value = "";
      errorEl.hidden = true;
      row.hidden = true;
      refresh();
      input.blur();
    });
    input.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !post.disabled) form.requestSubmit ? form.requestSubmit() : post.click();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (posting || post.disabled) return;
      posting = true;
      post.disabled = true;
      post.textContent = "Posting…";
      errorEl.hidden = true;
      try {
        const created = await postComment(input.value, null);
        remember([created]);
        st.topLevel.unshift(created);
        st.comments += 1;
        const list = $("comment-list");
        const status = list.querySelector(".comments-status");
        if (status) status.remove();
        list.insertAdjacentHTML("afterbegin", commentHTML(created));
        renderCounts();
        input.value = "";
        row.hidden = true;
        input.blur();
      } catch (err) {
        errorEl.textContent = friendlyError(err);
        errorEl.hidden = false;
      }
      posting = false;
      post.textContent = "Comment";
      refresh();
    });
  }

  async function postComment(text, parentId) {
    const body = String(text || "").trim();
    const { data, error } = await supabase
      .from("sermon_comments")
      .insert({ sermon_id: sermon.id, parent_id: parentId, user_id: viewer.id, body })
      .select()
      .single();
    if (error) throw error;
    return { author_name: profile.name || "Member", love_count: 0, ...data };
  }

  // ------------------------------------------------------------------ replies
  function closeReplyForms() {
    mount.querySelectorAll(".reply-form").forEach((f) => f.remove());
  }

  function openReply(row) {
    if (!viewer) return goSignIn("comment");
    closeReplyForms();
    const isReply = row.classList.contains("is-reply");
    const topRow = isReply ? row.closest(".comment:not(.is-reply)") : row; // a reply to a reply sits under the same comment
    const name = byId.get(row.dataset.id)?.author_name || "";
    const slot = row.querySelector(".reply-slot");
    slot.innerHTML = `
      <form class="reply-form" autocomplete="off">
        <textarea rows="1" maxlength="${MAX_LENGTH}" placeholder="Add a reply…" aria-label="Add a reply"></textarea>
        <div class="composer-row">
          <span class="composer-count"></span>
          <button type="button" class="composer-cancel reply-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary composer-post" disabled>Reply</button>
        </div>
        <p class="composer-error" role="alert" hidden></p>
      </form>`;
    const form = slot.querySelector(".reply-form");
    const input = form.querySelector("textarea");
    const post = form.querySelector(".composer-post");
    const errorEl = form.querySelector(".composer-error");
    const refresh = wireBox(input, post, form.querySelector(".composer-count"));
    if (isReply && name) input.value = `@${name} `;
    refresh();
    input.focus();
    form.querySelector(".reply-cancel").addEventListener("click", () => form.remove());
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (posting || post.disabled) return;
      posting = true;
      post.disabled = true;
      post.textContent = "Posting…";
      errorEl.hidden = true;
      try {
        const parentId = topRow.dataset.id;
        const created = await postComment(input.value, parentId);
        remember([created]);
        const siblings = st.replies.get(parentId) || [];
        siblings.push(created);
        st.replies.set(parentId, siblings);
        st.comments += 1;
        topRow.querySelector(".replies").insertAdjacentHTML("beforeend", commentHTML(created, { reply: true }));
        renderCounts();
        form.remove();
      } catch (err) {
        errorEl.textContent = friendlyError(err);
        errorEl.hidden = false;
        post.textContent = "Reply";
        post.disabled = false;
      }
      posting = false;
    });
  }

  // ------------------------------------------------------------------ love (a comment, or the sermon)
  function paintCommentLove(btn, loved, count) {
    btn.classList.toggle("loved", loved);
    btn.setAttribute("aria-pressed", String(loved));
    btn.dataset.count = String(count);
    const el = btn.querySelector(".c-love-count");
    el.textContent = count > 0 ? compactCount(count) : "";
    el.hidden = !(count > 0);
  }

  async function toggleCommentLove(btn, id) {
    if (!viewer) return goSignIn("love");
    if (btn.disabled) return;
    const was = btn.getAttribute("aria-pressed") === "true";
    const before = Number(btn.dataset.count) || 0;
    const after = Math.max(0, before + (was ? -1 : 1));
    paintCommentLove(btn, !was, after); // shows at once; undone below if it didn't work
    btn.disabled = true;
    const { error } = was
      ? await supabase.from("comment_loves").delete().eq("comment_id", id).eq("user_id", viewer.id)
      : await supabase.from("comment_loves").insert({ comment_id: id, user_id: viewer.id });
    btn.disabled = false;
    if (error && error.code !== "23505") {
      paintCommentLove(btn, was, before);
      note(friendlyError(error));
      return;
    }
    if (was) st.myCommentLoves.delete(id);
    else st.myCommentLoves.add(id);
    const c = byId.get(id);
    if (c) c.love_count = after;
  }

  async function toggleSermonLove() {
    if (!viewer) return goSignIn("love");
    const btn = $("sermon-love");
    if (btn.disabled) return;
    const was = st.loved;
    const before = st.loves;
    st.loved = !was;
    st.loves = Math.max(0, before + (was ? -1 : 1));
    renderCounts();
    btn.disabled = true;
    const id = sermon.id;
    const { error } = was
      ? await supabase.from("sermon_loves").delete().eq("sermon_id", id).eq("user_id", viewer.id)
      : await supabase.from("sermon_loves").insert({ sermon_id: id, user_id: viewer.id });
    btn.disabled = false;
    if (id !== sermon.id) return; // they moved to another sermon meanwhile
    if (error && error.code !== "23505") {
      st.loved = was;
      st.loves = before;
      renderCounts();
      note(friendlyError(error));
    }
  }

  // ------------------------------------------------------------------ deleting
  async function removeComment(row) {
    const id = row.dataset.id;
    const c = byId.get(id);
    if (!c) return;
    const replyCount = c.parent_id ? 0 : (st.replies.get(id) || []).length;
    const question = replyCount ? `Delete this comment and its ${replyCount} ${replyCount === 1 ? "reply" : "replies"}?` : "Delete this comment?";
    if (!confirm(question)) return;
    const { data, error } = await supabase.from("sermon_comments").delete().eq("id", id).select();
    if (error || !data || data.length === 0) {
      note(error ? friendlyError(error) : "That comment couldn't be deleted.");
      return;
    }
    byId.delete(id);
    if (c.parent_id) {
      st.replies.set(c.parent_id, (st.replies.get(c.parent_id) || []).filter((r) => r.id !== id));
    } else {
      st.topLevel = st.topLevel.filter((t) => t.id !== id);
      for (const r of st.replies.get(id) || []) byId.delete(r.id);
      st.replies.delete(id);
    }
    st.comments = Math.max(0, st.comments - 1 - replyCount);
    row.remove();
    renderCounts();
    renderEmptyIfNeeded();
  }

  // ------------------------------------------------------------------ share
  async function share() {
    const url = new URL(`watch.html?kind=sermon&id=${encodeURIComponent(sermon.id)}`, location.href).href;
    const data = { title: sermon.title, text: `Watch “${sermon.title}” on Flood Church`, url };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(data);
      } catch (e) {
        /* they closed the share sheet: nothing to do */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      note("Link copied. Paste it anywhere to share.");
    } catch (e) {
      window.prompt("Copy this link to share the sermon", url);
    }
  }

  // ------------------------------------------------------------------ loading
  async function loadExtras(topList, my) {
    // replies to these comments, and which of them this member has loved
    const ids = topList.map((c) => c.id);
    const repliesRes = ids.length
      ? await supabase.from("sermon_comments").select("*").eq("sermon_id", sermon.id).in("parent_id", ids).order("created_at", { ascending: true })
      : { data: [] };
    if (my !== token) return false;
    for (const r of repliesRes.data || []) {
      const list = st.replies.get(r.parent_id) || [];
      list.push(r);
      st.replies.set(r.parent_id, list);
    }
    remember(topList);
    remember(repliesRes.data || []);
    if (viewer) {
      const all = [...ids, ...(repliesRes.data || []).map((r) => r.id)];
      const lovedRes = all.length ? await supabase.from("comment_loves").select("comment_id").eq("user_id", viewer.id).in("comment_id", all) : { data: [] };
      if (my !== token) return false;
      for (const row of lovedRes.data || []) st.myCommentLoves.add(row.comment_id);
    }
    return true;
  }

  async function load() {
    const my = ++token;
    const id = sermon.id;
    st = { loves: 0, comments: 0, loved: false, topLevel: [], replies: new Map(), myCommentLoves: new Set(), hasMore: false };
    byId.clear();
    profile = { name: "", staff: false };
    mount.innerHTML = skeleton();
    renderCounts();
    $("comments-more").hidden = true;

    let results;
    try {
      results = await Promise.all([
        supabase.from("sermon_stats").select("loves, comments").eq("sermon_id", id).maybeSingle(),
        supabase.from("sermon_comments").select("*").eq("sermon_id", id).is("parent_id", null).order("created_at", { ascending: false }).limit(PAGE + 1),
        viewer ? supabase.from("profiles").select("name, is_admin, is_pastor").eq("id", viewer.id).maybeSingle() : Promise.resolve({ data: null }),
        viewer ? supabase.from("sermon_loves").select("sermon_id").eq("sermon_id", id).eq("user_id", viewer.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
    } catch (err) {
      if (my === token) showLoadError();
      return;
    }
    if (my !== token) return;
    const [statsRes, topRes, profileRes, loveRes] = results;
    if (topRes.error) return showLoadError();

    profile = { name: profileRes.data?.name || "", staff: Boolean(profileRes.data?.is_admin || profileRes.data?.is_pastor) };
    const top = topRes.data || [];
    st.hasMore = top.length > PAGE;
    st.topLevel = top.slice(0, PAGE);
    st.loves = Number(statsRes.data?.loves) || 0;
    st.comments = Number(statsRes.data?.comments) || 0;
    st.loved = Boolean(loveRes.data);
    if (!(await loadExtras(st.topLevel, my))) return;
    if (!statsRes.data) st.comments = st.topLevel.length + [...st.replies.values()].reduce((n, r) => n + r.length, 0);

    $("composer-mount").innerHTML = composerHTML();
    wireComposer();
    renderCounts();
    renderList();
  }

  function showLoadError() {
    $("composer-mount").innerHTML = "";
    $("comment-list").innerHTML = `
      <p class="comments-status">Couldn't load the comments. Check your connection and try again.</p>
      <button type="button" class="btn btn-outline" id="comments-retry">Try again</button>`;
    $("comments-retry").addEventListener("click", load);
  }

  async function loadMore() {
    const more = $("comments-more");
    const last = st.topLevel[st.topLevel.length - 1];
    if (!last || more.disabled) return;
    const my = token;
    more.disabled = true;
    more.textContent = "Loading…";
    const res = await supabase.from("sermon_comments").select("*").eq("sermon_id", sermon.id).is("parent_id", null).lt("created_at", last.created_at).order("created_at", { ascending: false }).limit(PAGE + 1);
    if (my !== token) return;
    more.disabled = false;
    more.textContent = "Show more comments";
    if (res.error) return note(friendlyError(res.error));
    const rows = res.data || [];
    st.hasMore = rows.length > PAGE;
    const page = rows.slice(0, PAGE);
    st.topLevel.push(...page);
    if (!(await loadExtras(page, my))) return;
    $("comment-list").insertAdjacentHTML("beforeend", page.map((c) => commentHTML(c)).join(""));
    more.hidden = !st.hasMore;
  }

  function skeleton() {
    return `
      <section class="social" aria-label="Love, share and comments">
        <div class="social-bar">
          <button type="button" class="social-btn love-btn" id="sermon-love" aria-pressed="false" aria-label="Love this sermon">${ICONS.heart}<span class="social-count" id="love-count" hidden></span><span class="social-label">Love</span></button>
          <button type="button" class="social-btn" id="sermon-share" aria-label="Share this sermon">${ICONS.share}<span class="social-label">Share</span></button>
          <button type="button" class="social-btn" id="sermon-jump" aria-label="Go to the comments">${ICONS.comment}<span class="social-count" id="bar-comment-count" hidden></span><span class="social-label">Comments</span></button>
        </div>
        <p class="social-note" id="social-note" role="status" aria-live="polite"></p>
        <h2 class="section-title comments-title" id="comments">Comments <span class="comments-total" id="comments-total" hidden></span></h2>
        <div id="composer-mount"></div>
        <div class="comment-list" id="comment-list"><p class="comments-status">Loading comments…</p></div>
        <button type="button" class="btn btn-outline comments-more" id="comments-more" hidden>Show more comments</button>
      </section>`;
  }

  // ------------------------------------------------------------------ one set of listeners for the whole section
  mount.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !mount.contains(btn) || !st) return;
    const row = btn.closest(".comment");
    if (btn.id === "sermon-love") toggleSermonLove();
    else if (btn.id === "sermon-share") share();
    else if (btn.id === "sermon-jump") {
      const target = $("comments");
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (btn.id === "comments-more") loadMore();
    else if (row && btn.classList.contains("c-love")) toggleCommentLove(btn, row.dataset.id);
    else if (row && btn.classList.contains("c-reply")) openReply(row);
    else if (row && btn.classList.contains("c-delete")) removeComment(row);
  });

  return {
    /** Show the Love / Share / Comments for this sermon. */
    show(item) {
      sermon = { id: String(item.id), title: String(item.title || "Sermon") };
      return load();
    },
    destroy() {
      token += 1;
      sermon = null;
      st = null;
      clearTimeout(noteTimer);
      mount.innerHTML = "";
    },
  };
}
