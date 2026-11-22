// growth-files.js — pictures and documents in Growth Group chats.
//
// Rules (the database enforces the same ones): pictures (JPG, PNG, WebP, GIF) and documents (PDF, Word, Excel,
// PowerPoint, text, CSV), at most 10 MB. Pictures are shrunk before sending so they use little mobile data.
// Files are kept in a PRIVATE storage area; they are opened through short-lived private links, never public ones.
import { shrinkImage } from "./image-tools.js";

export const BUCKET = "growth-files";
export const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PICTURE_BEFORE_SHRINKING = 40 * 1024 * 1024;
export const ACCEPT_DOCS = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** The documents that can be sent: file ending → [what the file is, its short name, a colour group]. */
export const DOCUMENT_TYPES = {
  pdf: ["application/pdf", "PDF", "pdf"],
  doc: ["application/msword", "Word", "word"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Word", "word"],
  xls: ["application/vnd.ms-excel", "Excel", "sheet"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Excel", "sheet"],
  ppt: ["application/vnd.ms-powerpoint", "PowerPoint", "slides"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "PowerPoint", "slides"],
  txt: ["text/plain", "Text", "text"],
  csv: ["text/csv", "CSV", "sheet"],
};

export const TOO_BIG = "That file is bigger than 10 MB.";
export const NOT_ALLOWED = "That kind of file can't be sent. Pictures, PDF, Word, Excel, PowerPoint, text and CSV files work.";

/** "report.final.PDF" → "pdf" */
export function extOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

/** "850 KB", "1.2 MB" */
export function formatSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  const mb = b / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, "") : Math.round(mb)} MB`;
}

/** What kind of document this is, for its label and colour ("PDF", "Word", …). */
export function documentInfo(name) {
  const t = DOCUMENT_TYPES[extOf(name)];
  return t ? { label: t[1], tone: t[2] } : { label: "File", tone: "file" };
}

/** Can this file be sent? { ok: true, kind: "image" | "file", mime } or { ok: false, reason }. */
export function classifyFile(file) {
  if (!file) return { ok: false, reason: "No file was chosen." };
  const type = String(file.type || "").toLowerCase();
  if (type.startsWith("image/")) {
    if (!IMAGE_MIME.has(type)) return { ok: false, reason: "Please choose a JPG, PNG, WebP or GIF picture." };
    if (file.size > MAX_PICTURE_BEFORE_SHRINKING) return { ok: false, reason: "That picture is too large." };
    if (file.size === 0) return { ok: false, reason: "That file is empty." };
    return { ok: true, kind: "image", mime: type };
  }
  const doc = DOCUMENT_TYPES[extOf(file.name)];
  if (!doc) return { ok: false, reason: NOT_ALLOWED };
  if (file.size === 0) return { ok: false, reason: "That file is empty." };
  if (file.size > MAX_BYTES) return { ok: false, reason: TOO_BIG };
  return { ok: true, kind: "file", mime: doc[0] };
}

/** A name that is safe to keep in storage: letters, digits, dot, dash, underscore; never empty. */
export function safeFileName(name) {
  const ext = extOf(name);
  const clean = (t) => String(t || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[_.-]+|[_.-]+$/g, "").slice(0, 60);
  const stem = clean(String(name || "").replace(/\.[A-Za-z0-9]+$/, ""));
  if (!stem && ext) return clean(ext) || "file"; // a name that is only an ending (".hidden")
  return ext ? `${stem || "file"}.${ext}` : stem || "file";
}

/** Where a file is kept: <group>/<person>/<time>-<random>-<name> (the first two parts are checked by the database). */
export function attachmentPath(groupId, userId, name, now = Date.now(), rand = Math.random().toString(36).slice(2, 8)) {
  return `${groupId}/${userId}/${now}-${rand}-${safeFileName(name)}`;
}

/** A long file name shortened in the middle, keeping its ending ("Sunday_service_notes…final.pdf"). */
export function displayName(name, max = 120) {
  const n = String(name || "file").trim() || "file";
  return n.length <= max ? n : `${n.slice(0, max - 12)}…${n.slice(-10)}`;
}

/**
 * Gets a file ready to send: checks it, and shrinks a picture (a 6 MB phone photo becomes a few hundred KB).
 * Returns { file, kind, mime, name, size }; throws an Error with a plain-English message if it can't be sent.
 */
export async function prepareAttachment(file) {
  const c = classifyFile(file);
  if (!c.ok) throw new Error(c.reason);
  let out = file;
  let mime = c.mime;
  if (c.kind === "image" && mime !== "image/gif") {
    out = await shrinkImage(file, { maxSide: 1600, quality: 0.82 });
    mime = out.type || mime;
  }
  if (out.size > MAX_BYTES) throw new Error(c.kind === "image" ? "That picture is still bigger than 10 MB." : TOO_BIG);
  return { file: out, kind: c.kind, mime, name: displayName(out.name || (c.kind === "image" ? "photo.jpg" : "file")), size: out.size };
}

/**
 * Private links to the files. A link works for an hour, so they are fetched when needed, kept for a while,
 * and fetched again when they are about to run out. Downloads get their own short-lived link that saves the file with its real name.
 */
export function createFileUrls(supabase, { ttl = 3600 } = {}) {
  const cache = new Map();
  const bucket = () => supabase.storage.from(BUCKET);
  const fresh = (e) => Boolean(e) && e.until > Date.now() + 5 * 60000;
  const self = {
    /** A usable link we already have (or null). */
    peek(path) {
      const e = cache.get(path);
      return fresh(e) ? e.url : null;
    },
    /** Gets links for many files in ONE request. Never throws. */
    async prefetch(paths) {
      const need = [...new Set(paths)].filter((p) => p && !fresh(cache.get(p)));
      if (!need.length) return;
      try {
        const { data } = await bucket().createSignedUrls(need, ttl);
        for (const row of data || []) if (row && row.signedUrl && !row.error) cache.set(row.path, { url: row.signedUrl, until: Date.now() + ttl * 1000 });
      } catch (e) {
        /* the pictures just stay as placeholders until the next try */
      }
    },
    async get(path) {
      await self.prefetch([path]);
      return self.peek(path);
    },
    /** A link that saves the file under its own name. */
    async download(path, name) {
      try {
        const { data, error } = await bucket().createSignedUrl(path, 300, { download: name });
        return error || !data ? null : data.signedUrl;
      } catch (e) {
        return null;
      }
    },
  };
  return self;
}
