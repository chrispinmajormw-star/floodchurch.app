// image-tools.js — makes a photo small enough to upload and to show quickly on a phone.
//
// A poster photographed on a phone is often 4–8 MB. Members would pay for that in mobile data every time it
// is shown, so the dashboard shrinks it first: at most 1600 pixels on the longest side, saved as a JPEG.
// That keeps a flyer perfectly readable at roughly 200–400 KB.

const MAX_SIDE = 1600;
const QUALITY = 0.85;

/** The size an image should be so its longest side is at most `maxSide` (never made bigger). */
export function fitWithin(width, height, maxSide = MAX_SIDE) {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Returns a smaller copy of a JPEG/PNG/WebP photo. Anything else (a GIF, a drawing, a video…), a browser that
 * can't do it, or a result that isn't actually smaller: the original file comes back untouched.
 */
export async function shrinkImage(file, { maxSide = MAX_SIDE, quality = QUALITY } = {}) {
  try {
    if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type || "")) return file;
    if (typeof createImageBitmap !== "function") return file;

    const bitmap = await createImageBitmap(file); // also turns a sideways phone photo upright
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff"; // a PNG's see-through parts become white, not black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file; // never make it bigger
    return new File([blob], (file.name || "poster").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch (e) {
    return file;
  }
}
