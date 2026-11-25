// growth-location.js — sharing a location pin in a Growth Group chat.
//
// A pin is a one-time snapshot (where you are right now), never live tracking. It is only taken when the person taps
// "Location" in the attach menu, they see exactly what will be shared, and nothing is sent until they tap Send.
// Everything here is plain functions so it can be tested without a phone.

/** Coordinates to about a metre (5 decimal places): plenty for "this is where we meet", and no false precision. */
// (Only real numbers: a missing value or text must never turn into 0, which is a real place in the sea off Africa.)
export const roundCoord = (n) => (typeof n === "number" ? Math.round(n * 1e5) / 1e5 : NaN);

/** A real place on Earth? (numbers only: a missing value or text is never a place) */
export function validPin(lat, lng) {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** The pin inside a message row, or null when the row has none (or has nonsense, which is then never shown). */
export function pinOf(m) {
  if (!m || m.location_lat == null || m.location_lng == null) return null;
  if (!validPin(m.location_lat, m.location_lng)) return null;
  const a = m.location_accuracy;
  return { lat: m.location_lat, lng: m.location_lng, accuracy: typeof a === "number" && Number.isFinite(a) && a >= 0 ? a : null };
}

// The links are built from numbers only (never from text anyone typed), so they can't be made to point anywhere else.
const pair = (lat, lng) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
export const mapsUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${pair(lat, lng)}`;
export const directionsUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${pair(lat, lng)}`;
export const formatCoords = (lat, lng) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

/** "±12 m" or "±1.2 km"; empty when the phone didn't say. */
export function accuracyText(metres) {
  if (typeof metres !== "number" || !Number.isFinite(metres) || metres < 0) return "";
  if (metres >= 1000) return `\u00b1${(metres / 1000).toFixed(1)} km`;
  return `\u00b1${Math.max(1, Math.round(metres))} m`;
}

/** A pin the phone itself isn't sure about (over 200 m out) — we say so before it is sent. */
export const isRough = (metres) => typeof metres === "number" && metres > 200;

/** What went wrong, in words a member can act on. */
export function locationErrorMessage(err) {
  const code = err && err.code;
  if (code === 1) return "Location is turned off for this app. Allow it in your phone's settings (or in the browser), then try again.";
  if (code === 2) return "Couldn't find your location. Check that GPS is on and try again.";
  if (code === 3) return "Finding your location is taking too long. Try again, ideally outside.";
  if (err && err.message === "unsupported") return "This phone or browser can't share a location.";
  if (err && err.message === "insecure") return "Sharing a location needs a secure connection.";
  return "Couldn't get your location. Please try again.";
}

/**
 * Asks the phone where it is right now (the phone shows its own permission question the first time).
 * Resolves { lat, lng, accuracy }; rejects with an Error whose message is ready to show.
 * `timeout` is how long to wait for a fix; `grace` more milliseconds is a safety timer for phones that never answer at all.
 */
export function getCurrentPin({ timeout = 15000, grace = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : null;
    if (typeof window !== "undefined" && window.isSecureContext === false) return reject(new Error(locationErrorMessage({ message: "insecure" })));
    if (!geo || typeof geo.getCurrentPosition !== "function") return reject(new Error(locationErrorMessage({ message: "unsupported" })));
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      fn(value);
    };
    const safety = setTimeout(() => finish(reject, new Error(locationErrorMessage({ code: 3 }))), timeout + grace);
    try {
      geo.getCurrentPosition(
        (pos) => {
          const c = pos && pos.coords;
          const lat = c ? roundCoord(c.latitude) : NaN;
          const lng = c ? roundCoord(c.longitude) : NaN;
          if (!validPin(lat, lng)) return finish(reject, new Error(locationErrorMessage(null)));
          const accuracy = Number.isFinite(c.accuracy) ? Math.min(100000, Math.max(0, Math.round(c.accuracy))) : null;
          finish(resolve, { lat, lng, accuracy });
        },
        (err) => finish(reject, new Error(locationErrorMessage(err))),
        { enableHighAccuracy: true, timeout, maximumAge: 0 } // a fresh reading, never an old one
      );
    } catch (e) {
      finish(reject, new Error(locationErrorMessage(null)));
    }
  });
}
