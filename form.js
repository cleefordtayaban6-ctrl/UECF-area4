// Shared by member-form.html and officer-form.html
const $ = id => document.getElementById(id);
const CFG = window.APP_CONFIG || {};
const CENTERS = ["Puon ti Biag","Damasco","Ti libro a naselloan","Eufrates","Baro Jerusalem","Pergamo","Patmos","Raniag ti lawag","Galilea","Tesalonica","Galacia","Baro a langit","Getsemani"];
const SKIP = "Optional: you can skip this if you don't want to fill it in.";
const CIVIL = ["Single","Married","Separated","Widow (Woman)","Widower (Man)"];
const CATS = [["Junior FYS","Junior FYS (ages 7–12)"],["Senior FYS","Senior FYS (ages 13–30)"],["Katandaan","Katandaan / Elders (30+, or any married, separated or widowed person)"]];
const GIFTS = ["Medium","Perlante/Saksi","Evangelista","Vidente","Corandera","Corandero","Angeles ti Daga (kumakanta/cantora)"];
const say = (t, c) => { $("msg").textContent = t; $("msg").className = c || ""; };
let db = null;
if (!CFG.url || CFG.url.includes("YOUR-")) say("Setup incomplete: the admin must fill in config.js.", "err");
else if (!window.supabase) say("Could not load the page fully. Check your internet and refresh.", "err");
// Forms ALWAYS submit as the public (anon) user, even if the admin is logged in on this phone, so an
// expired admin session can never block a registration. A 60s timeout stops a bad signal from hanging forever.
else db = supabase.createClient(CFG.url, CFG.key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (u, o = {}) => { const c = new AbortController(), t = setTimeout(() => c.abort(), 60000);
    return fetch(u, { ...o, signal: c.signal }).finally(() => clearTimeout(t)); } }
});
// crypto.randomUUID is missing on older phones; fall back so uploads never fail for that reason
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });

// Marriage/widowhood marks elder status in this community, so any non-Single civil status
// suggests Katandaan regardless of age. Age alone is only a hint.
function suggestedCategory(age, civilStatus) {
  if (civilStatus && civilStatus !== "Single") return "Katandaan";
  if (age >= 30) return "Katandaan";
  if (age >= 13) return "Senior FYS";
  if (age >= 7) return "Junior FYS";
  return null;
}
function ageWarning(age, category, civilStatus) {
  if (civilStatus && civilStatus !== "Single" && category === "Katandaan") return null; // explained by marital status
  const [min, max] = { "Junior FYS": [7, 12], "Senior FYS": [13, 30], "Katandaan": [30, 120] }[category] || [];
  if (min == null) return null;
  return (age < min || age > max) ? "Heads up: this age is unusual for the selected category. You may still continue." : null;
}
function ageOf(dob) {
  const d = new Date(dob + "T00:00:00"), n = new Date();
  if (!dob || isNaN(d) || d > n) return null;
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}
function friendly(err) {
  console.error(err);
  const m = (err && err.message) || "";
  if (m.startsWith("FRIENDLY:")) return m.slice(9);
  if ((err && err.name === "AbortError") || /abort/i.test(m)) return "Your connection is slow. Please check your signal and try again.";
  if (/BLOCKED/.test(m)) return "We are not able to accept this registration. Please contact the admin.";
  if (/DUPLICATE_EMAIL|members_email_name_uidx/.test(m) || (err && err.code === "23505")) return "This person is already registered (same name and email).";
  if (!navigator.onLine || /fetch|network/i.test(m)) return "No internet connection. Check your signal and try again.";
  return "Something went wrong. Please try again, or tell the admin.";
}
// ---- White background pipeline: runs entirely in the browser (no server, no API key) ----
// 1) shrink to ~900px  2) cut the person out with @imgly/background-removal  3) paint the cut-out on pure white
// 4) export JPEG. If the cut-out fails or takes too long, the original is flattened onto white instead.
const BG_LIB = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm";
const BG_TIMEOUT = 30000; // ms to wait for the cut-out before falling back to plain flattening
let bgLib = null;         // module promise: loaded once, on first use
function loadBgLib() {
  if (!bgLib) bgLib = import(BG_LIB).catch(e => { bgLib = null; throw e; }); // a failed load can be retried
  return bgLib;
}
const withTimeout = (p, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("timeout")), ms);
  p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
});
const loadImage = blob => new Promise((res, rej) => {
  const img = new Image(), u = URL.createObjectURL(blob);
  img.onload = () => { URL.revokeObjectURL(u); res(img); };
  img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("unreadable")); };
  img.src = u;
});
const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("toBlob")), type, q));
function opaqueShare(img) { // share of clearly visible pixels: a near-empty cut-out means the removal failed
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data; let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
  return n / (64 * 64);
}
async function whiteBg(file, box) { // -> { blob: JPEG on #FFFFFF, removed: true if the background was really cut out, fixed: sharpened, score0/score: sharpness }
  const img = await loadImage(file);
  const s = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
  const base = document.createElement("canvas"); base.width = w; base.height = h;
  base.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
  // Blur gate, judged on the exact picture that will be stored: clear -> pass; slightly soft -> sharpen once and re-test;
  // very soft, or still soft after sharpening -> reject. Runs before the (slow) background removal.
  const score0 = sharpness(base, box); let score = score0, fixed = false;
  if (score < SHARP_OK) {
    const bad = () => { const e = new Error("BLURRY"); e.score = score; e.score0 = score0; return e; };
    if (score < SHARP_MIN) throw bad();
    const x0 = base.getContext("2d"), id = x0.getImageData(0, 0, w, h);
    unsharpData(id.data, w, h, 1.0, 2); x0.putImageData(id, 0, 0);
    fixed = true; score = sharpness(base, box);
    if (score < SHARP_OK) throw bad();
  }
  const cutOut = async () => {
    const mod = await loadBgLib();
    const fn = typeof mod.removeBackground === "function" ? mod.removeBackground : (mod.default && mod.default.removeBackground) || mod.default;
    if (typeof fn !== "function") throw new Error("removeBackground not found");
    const out = await fn(await toBlob(base, "image/jpeg", 0.92), { model: "isnet_quint8", device: "cpu", output: { format: "image/png" } }); // smallest model, no GPU needed: safest on phones
    const cut = await loadImage(out);
    if (opaqueShare(cut) < 0.06) throw new Error("empty cut-out");
    return cut;
  };
  let cut = null;
  try { cut = await withTimeout(cutOut(), BG_TIMEOUT); } catch (e) { console.warn("Background removal skipped:", e); }
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, w, h);
  x.drawImage(cut || base, 0, 0, w, h);
  return { blob: await toBlob(c, "image/jpeg", 0.85), removed: !!cut, fixed, score0, score };
}

// ---- Face check (whole face inside the frame) + sharpness gate ----
// Face: MediaPipe Face Landmarker, loaded lazily from the CDN (about 15 MB the first time, cached afterwards).
// The photo is refused if no face is found, if two faces are found, or if any face landmark touches or leaves the edge.
// If the detector cannot run (offline, old phone) the native FaceDetector is tried; if neither works the photo is
// accepted with a notice, so a tooling problem never blocks a registration.
const MP_LIB = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
const MP_WASM = MP_LIB + "/wasm";
const MP_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const FACE_TIMEOUT = 30000; // ms
// Sharpness = variance of the Laplacian on a 160x160 crop of the face (higher = sharper). These are STARTING values:
// add ?debug to the page address to see each photo's score on screen, then adjust with a few sharp and blurry photos.
const SHARP_OK = 60;   // at or above: sharp enough
const SHARP_MIN = 30;  // below: too blurry to repair, rejected; between MIN and OK: sharpened once, then re-tested
const DEBUG = /[?&]debug(=|&|$)/.test(location.search);
let faceLm = null;
function loadFaceLm() {
  if (!faceLm) faceLm = (async () => {
    const mod = await import(MP_LIB);
    const ns = mod.FaceLandmarker ? mod : (mod.default || mod);
    const fileset = await ns.FilesetResolver.forVisionTasks(MP_WASM);
    return ns.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MP_MODEL, delegate: "CPU" }, runningMode: "IMAGE", numFaces: 3 }); // CPU: slower than GPU but works on every phone
  })().catch(e => { faceLm = null; throw e; });
  return faceLm;
}
const FACE_MSG = {
  none: "We could not find a full face in this photo. Face the camera in good light, with your whole face and some space around your head in the picture.",
  multi: "More than one face was detected. An ID photo must show only you.",
  cut: "Part of your face is cut off or touches the edge of the photo. Your whole face must be visible, with a little space around your head.",
  small: "Your face is too small in the photo. Move closer or crop to head and shoulders.",
  turned: "Please face the camera straight on so your whole face is visible."
};
// -> { err } to reject, or { box: {x0,y0,x1,y1} (0..1) | null, note }
async function checkFace(img) {
  const s = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  let faces = null;
  try { faces = (await withTimeout(loadFaceLm(), FACE_TIMEOUT)).detect(c).faceLandmarks || []; }
  catch (e) { console.warn("Face Landmarker unavailable:", e); }
  if (faces) {
    if (!faces.length) return { err: FACE_MSG.none };
    if (faces.length > 1) return { err: FACE_MSG.multi };
    const p = faces[0]; let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
    for (const q of p) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
    const m = 0.01; // landmarks of a cropped face land on or beyond the image edge
    if (x0 < m || y0 < m || x1 > 1 - m || y1 > 1 - m) return { err: FACE_MSG.cut };
    if (y1 - y0 < 0.18) return { err: FACE_MSG.small };
    const eyeW = p[263].x - p[33].x; // outer eye corners and nose tip: a strongly turned head puts the nose far from the middle
    if (eyeW > 0.02) { const r = (p[1].x - p[33].x) / eyeW; if (r < 0.25 || r > 0.75) return { err: FACE_MSG.turned }; }
    return { box: { x0, y0, x1, y1 } };
  }
  if (window.FaceDetector) { // fallback: the browser's own detector (Chrome on Android)
    try {
      const f = await new FaceDetector({ fastMode: true, maxDetectedFaces: 5 }).detect(img);
      const W = img.naturalWidth, H = img.naturalHeight;
      if (f.length > 1) return { err: FACE_MSG.multi };
      if (f.length === 1) {
        const b = f[0].boundingBox;
        if (b.x < W * 0.01 || b.y < H * 0.01 || b.x + b.width > W * 0.99 || b.y + b.height > H * 0.99) return { err: FACE_MSG.cut };
        if (b.height / H < 0.2) return { err: FACE_MSG.small };
        return { box: { x0: b.x / W, y0: b.y / H, x1: (b.x + b.width) / W, y1: (b.y + b.height) / H } };
      }
    } catch (_) { /* fall through */ }
  }
  return { box: null, note: "Photo accepted, but we could not check your face automatically. Make sure your whole face is visible and sharp." };
}
function lapVar(g, N) { // variance of the 4-neighbour Laplacian over an N x N grey image
  let sum = 0, sq = 0, n = 0;
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = y * N + x, v = g[i - 1] + g[i + 1] + g[i - N] + g[i + N] - 4 * g[i];
    sum += v; sq += v * v; n++;
  }
  return n ? sq / n - (sum / n) * (sum / n) : 0;
}
function sharpness(canvas, box) { // score of the middle 80% of the face box (or the upper middle of the photo when no face box)
  const b = box || { x0: 0.25, y0: 0.12, x1: 0.75, y1: 0.62 }, W = canvas.width, H = canvas.height, N = 160;
  const cx = (b.x0 + b.x1) / 2 * W, cy = (b.y0 + b.y1) / 2 * H, hw = Math.max(8, (b.x1 - b.x0) * W * 0.4), hh = Math.max(8, (b.y1 - b.y0) * H * 0.4);
  const sx = Math.max(0, cx - hw), sy = Math.max(0, cy - hh), sw = Math.max(1, Math.min(W - sx, hw * 2)), sh = Math.max(1, Math.min(H - sy, hh * 2));
  const t = document.createElement("canvas"); t.width = t.height = N;
  const x = t.getContext("2d", { willReadFrequently: true }); x.drawImage(canvas, sx, sy, sw, sh, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data, g = new Float32Array(N * N);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = .299 * d[p] + .587 * d[p + 1] + .114 * d[p + 2];
  return Math.round(lapVar(g, N) * 10) / 10;
}
function unsharpData(d, w, h, amount, r) { // sharpen RGBA data in place: out = orig + amount * (orig - boxBlur(orig))
  const k = 2 * r + 1, tmp = new Float32Array(w * h * 3), bl = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let ch = 0; ch < 3; ch++) {
    const row = y * w; let sum = 0;
    for (let x = -r; x <= r; x++) sum += d[(row + Math.min(w - 1, Math.max(0, x))) * 4 + ch];
    for (let x = 0; x < w; x++) {
      tmp[(row + x) * 3 + ch] = sum / k;
      sum += d[(row + Math.min(w - 1, x + r + 1)) * 4 + ch] - d[(row + Math.max(0, x - r)) * 4 + ch];
    }
  }
  for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + ch];
    for (let y = 0; y < h; y++) {
      bl[(y * w + x) * 3 + ch] = sum / k;
      sum += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + ch] - tmp[(Math.max(0, y - r) * w + x) * 3 + ch];
    }
  }
  for (let i = 0; i < w * h; i++) for (let ch = 0; ch < 3; ch++) { const o = d[i * 4 + ch]; d[i * 4 + ch] = o + amount * (o - bl[i * 3 + ch]); } // Uint8ClampedArray clamps 0..255
}

/*A*/
// Looks only at colours and edges. It cannot truly recognise an ID card or a hand, so it is a guard, not a judge:
// it catches the obvious cases (skin/wood at the edges, printed text in the lower part, busy backgrounds, very dark photos).
function analyzePixels(d, w, h) {
  const n = w * h, lum = new Float32Array(n), skin = new Uint8Array(n); let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2], y = .299 * r + .587 * g + .114 * b;
    lum[i] = y; sum += y;
    const cb = 128 - .168736 * r - .331264 * g + .5 * b, cr = 128 + .5 * r - .418688 * g - .081312 * b;
    skin[i] = (y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) ? 1 : 0;
  }
  const bx = Math.round(w * .12), by = Math.round(h * .10), ty0 = Math.round(h * .62);
  let bN = 0, bSkin = 0, bStrong = 0, tN = 0, tStrong = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, strong = (Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w])) > 50 ? 1 : 0;
    if (x < bx || x >= w - bx || y < by) { bN++; bSkin += skin[i]; bStrong += strong; }       // left, right and top edges
    else if (y >= ty0) { tN++; tStrong += strong; }                                           // lower middle, where an ID card has its text
  }
  return { bright: sum / n, skinEdge: bN ? bSkin / bN : 0, busy: bN ? bStrong / bN : 0, text: tN ? tStrong / tN : 0 };
}
// Two levels so a good photo is never stopped by a guess: clear cases are rejected, borderline cases only warn.
function lookProblem(a) {
  const M = {
    dark: "This photo is too dark. Take it again in good light.",
    skin: "Skin-coloured or wooden areas touch the edges of the photo (a hand, a table, or a face cropped too tight). Take a new photo of your face against a plain wall, with space around your head.",
    text: "This looks like a photo of an ID card or a printed picture. Please take a new photo of yourself, not a photo of a photo.",
    busy: "The background is too busy. Stand in front of a plain, light wall." };
  if (a.bright < 35) return { block: M.dark };
  if (a.skinEdge > 0.45) return { block: M.skin };
  if (a.text > 0.35) return { block: M.text };
  if (a.busy > 0.20) return { block: M.busy };
  if (a.bright < 45) return { warn: M.dark };
  if (a.skinEdge > 0.30) return { warn: M.skin };
  if (a.text > 0.22) return { warn: M.text };
  if (a.busy > 0.12) return { warn: M.busy };
  return null;
}
/*B*/
function lookCheck(img) {
  try {
    const s = Math.min(1, 200 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(20, Math.round(img.naturalWidth * s)), h = Math.max(20, Math.round(img.naturalHeight * s));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
    return lookProblem(analyzePixels(x.getImageData(0, 0, w, h).data, w, h));
  } catch (_) { return null; } // could not analyse: do not block the person
}

let photoOk = false; // true only after the chosen photo passes the ID-style checks
let photoBlob = null; // the white-background JPEG that will be uploaded (never the original)
let photoBusy = false; // true while the background is being removed
let touched = false; // true once the user manually picks a category
const curCat = () => (document.querySelector("input[name=cat]:checked") || {}).value || null;
function refresh() {
  const age = ageOf($("dob").value), civ = $("civil").value, nonSingle = civ && civ !== "Single";
  if (!touched) {
    const s = suggestedCategory(age, civ);
    if (s) document.querySelector(`input[name=cat][value="${s}"]`).checked = true;
  }
  const w = { "Married": "Married", "Separated": "Separated", "Widow (Woman)": "Widowed", "Widower (Man)": "Widowed" }[civ];
  $("hint").textContent = nonSingle ? `Since you are ${w}, we've suggested Katandaan (Elders). You can change this if you prefer.` : "";
  const cat = curCat();
  let warn = age != null && cat ? ageWarning(age, cat, civ) : null;
  // Soft note when someone married/widowed/separated overrides to a younger category (never a block)
  if (!warn && nonSingle && cat && cat !== "Katandaan") warn = "Note: marriage or widowhood usually means Katandaan in our community. You may still continue.";
  $("warn").textContent = warn || "";
}

function renderCommon(officer) {
  $("common").innerHTML = `
  <label for="first">First name *</label><input id="first" maxlength="60" autocomplete="given-name">
  <label for="middle">Middle name *</label><input id="middle" maxlength="60" autocomplete="additional-name">
  <label for="last">Last name *</label><input id="last" maxlength="60" autocomplete="family-name">
  <label for="suffix">Suffix (optional)</label><input id="suffix" maxlength="10" placeholder="Jr., Sr., III"><small class="skip">${SKIP}</small>
  <label for="dob">Date of birth *</label><input id="dob" type="date">
  <label for="gender">Gender *</label><select id="gender"><option value="">Select…</option><option>Male</option><option>Female</option></select>
  <label for="civil">Civil status *</label><select id="civil"><option value="">Select…</option>${CIVIL.map(c => `<option>${c}</option>`).join("")}</select>
  <fieldset style="border:0;padding:0;margin:14px 0 0"><legend style="font-weight:bold">Category *</legend>
    ${CATS.map(([v, t]) => `<label class="r"><input type="radio" name="cat" value="${v}"> ${t}</label>`).join("")}
  </fieldset>
  <div id="hint" class="hint" aria-live="polite"></div><div id="warn" class="warn" aria-live="polite"></div>
  <label for="center">${officer ? "Assigned center *" : "Center *"}</label>
  <select id="center"><option value="">Select…</option>${CENTERS.map(c => `<option>${c}</option>`).join("")}</select>
  ${officer ? '<small>Each center has its own officers. Select the center where you serve.</small>' : ""}
  <label for="gift">Spiritual gift *</label><select id="gift"><option value="">Select\u2026</option>${GIFTS.concat("None").map(g => `<option>${g}</option>`).join("")}</select>
  <label for="contact">Contact number (optional)</label><input id="contact" type="tel" maxlength="20" autocomplete="off"><small class="skip">${SKIP}</small>
  <label for="email">Email (optional)</label><input id="email" type="email" maxlength="120" autocomplete="off"><small class="skip">${SKIP}</small>
  <label for="address">Address *</label><input id="address" maxlength="200" autocomplete="off">
  <fieldset class="photo-card"><legend>Profile photo (ID-style) *</legend>
    <p class="ph-lead">Upload a photo like a <b>school ID or passport picture</b>. Casual, posed or Facebook-style pictures are not accepted.</p>
    <div class="ph-ex">
      <figure><svg viewBox="0 0 90 110" width="90" height="110" role="img" aria-label="Accepted: head and shoulders on a plain background"><rect width="90" height="110" rx="6" style="fill:var(--bg);stroke:var(--line)"/><circle cx="45" cy="42" r="19" style="fill:var(--mute)"/><path d="M12 110c2-26 17-38 33-38s31 12 33 38z" style="fill:var(--mute)"/></svg><figcaption class="ok">&#10003; Accepted</figcaption></figure>
      <figure><svg viewBox="0 0 90 110" width="90" height="110" role="img" aria-label="Not accepted: casual, wide or full-body photo with a busy background"><rect width="90" height="110" rx="6" style="fill:var(--bg);stroke:var(--line)"/><path d="M0 72l20-25 15 15 18-30 37 40v38H0z" style="fill:var(--line)"/><circle cx="62" cy="62" r="7" style="fill:var(--mute)"/><path d="M50 110c1-14 6-22 12-22s11 8 12 22z" style="fill:var(--mute)"/><path d="M10 10L80 100" style="stroke:var(--err);stroke-width:4"/></svg><figcaption class="bad">&#10007; Not accepted</figcaption></figure>
    </div>
    <ul class="req"><li>Plain, light background</li><li>Head and shoulders, facing the camera</li><li>Whole face clear, well lit, no filters</li><li>Only you in the photo; no hat or sunglasses</li><li>A photo of yourself, not of an ID card or printed picture; no hands or table in view</li></ul>
    <input id="photo" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose ID-style photo">
    <div id="pstat" class="pstat" role="status" aria-live="polite"></div>
    <img id="preview" alt="Photo preview">
    <label class="r"><input type="checkbox" id="idconfirm"> I confirm this is a recent school-ID style photo of myself.</label>
  </fieldset>
  <dialog id="tip"><h2 style="margin:0 0 8px;font-size:1.2rem">ID-style photo only</h2>
    <p>Choose a photo like a <b>school ID or passport picture</b>: plain background, head and shoulders, facing the camera, whole face clear.</p>
    <p><b>Not accepted:</b> casual or Facebook-style poses, selfies with filters, group or full-body shots, sunglasses or hats, photos of ID cards or printed pictures.</p>
    <button id="tipok" type="button">I understand, choose photo</button><button id="tipno" type="button" class="plain">Cancel</button></dialog>
  <div class="hp" aria-hidden="true"><label>Leave this empty <input id="hp_field" name="hp_field" tabindex="-1" autocomplete="off"></label></div>`;
  $("dob").max = new Date().toISOString().slice(0, 10);
  $("dob").oninput = $("dob").onchange = refresh;
  $("civil").onchange = () => { touched = false; refresh(); }; // civil status change re-suggests Katandaan
  document.querySelectorAll("input[name=cat]").forEach(r => r.onchange = () => { touched = true; refresh(); });
  let tipOk = false; // reminder shown every time
  $("photo").addEventListener("click", e => { if (typeof $("tip").showModal !== "function") return; /* very old phones: skip the reminder, never block the picker */ if (tipOk) { tipOk = false; return; } e.preventDefault(); $("tip").showModal(); });
  $("tipok").onclick = () => { $("tip").close(); tipOk = true; $("photo").click(); };
  $("tipno").onclick = () => $("tip").close();
  let photoSeq = 0, prevUrl = null; // preview object URL, revoked when replaced
  // Automatic checks: format, size, portrait/square shape, and (where the browser supports it) face count and size.
  // These catch obvious non-ID photos; the admin can still review every photo.
  $("photo").addEventListener("change", async () => {
    const f = $("photo").files[0], p = $("preview"), st = $("pstat"), seq = ++photoSeq;
    say(""); photoOk = false; photoBlob = null; photoBusy = false; p.style.display = "none"; st.textContent = ""; st.className = "pstat";
    if (prevUrl) { URL.revokeObjectURL(prevUrl); prevUrl = null; }
    if (!f) return;
    const fail = m => { if (seq !== photoSeq) return; $("photo").value = ""; p.style.display = "none"; st.textContent = "\u2717 " + m; st.className = "pstat bad"; };
    if (f.size > 25 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(f.type)) return fail("Please choose a JPG, PNG or WEBP photo.");
    const url = URL.createObjectURL(f), img = new Image();
    try { await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; }); }
    catch (_) { URL.revokeObjectURL(url); return fail("This photo could not be read. Please choose another one."); }
    const w = img.naturalWidth, h = img.naturalHeight, ratio = w / h;
    let msg = null, note = "";
    if (Math.min(w, h) < 300) msg = "This photo is too small or blurry. Use a clear photo at least 300 pixels wide.";
    else if (ratio > 1.15) msg = "This is a wide (landscape) photo. An ID photo is portrait or square, showing head and shoulders only.";
    else if (ratio < 0.6) msg = "This photo is too narrow. Use a normal portrait or square ID-style photo.";
    if (!msg) { const lp = lookCheck(img); if (lp && lp.block) msg = lp.block; else if (lp) note = "Photo accepted, but please check: " + lp.warn; }
    let box = null; // where the face is, so the blur test looks at the face and not at the wall
    if (!msg) {
      photoBusy = true; st.textContent = "Checking your face\u2026 (the first photo can take a little longer)"; st.className = "pstat";
      const fc = await checkFace(img);
      if (seq === photoSeq) photoBusy = false;
      if (fc.err) msg = fc.err; else { box = fc.box || null; if (fc.note && !note) note = fc.note; }
    }
    URL.revokeObjectURL(url); // the checks above ran on the original; the preview below shows the white-background version
    if (msg) return fail(msg);
    if (seq !== photoSeq) return;
    photoBusy = true; st.textContent = "Checking sharpness and removing background\u2026"; st.className = "pstat";
    let res;
    try { res = await whiteBg(f, box); }
    catch (e) {
      if (seq === photoSeq) photoBusy = false;
      if (e && e.message === "BLURRY") return fail("This photo is too blurry. Hold the phone steady, use good light, wipe the camera lens, and take it again." + (DEBUG ? " [sharpness " + e.score0 + (e.score !== e.score0 ? " \u2192 " + e.score : "") + ", needs " + SHARP_OK + "]" : ""));
      return fail("This photo could not be read. Please choose another one.");
    }
    if (seq !== photoSeq) return; // a newer photo was chosen meanwhile
    photoBusy = false;
    // ID-style rule: if the person cannot be separated from the background, the photo is not an ID-style photo. Refuse it.
    if (!res.removed) return fail("This is not an ID-style photo: the background could not be separated from you. Use a plain, light wall, stand facing the camera with only you in the frame, and take it again.");
    photoBlob = res.blob;
    prevUrl = URL.createObjectURL(res.blob); p.src = prevUrl; p.style.display = "block"; photoOk = true;
    const parts = [];
    if (note) parts.push(note);
    if (res.fixed) parts.push("The photo was slightly blurry, so it was sharpened automatically. A sharper photo is still better.");
    const dbg = DEBUG ? " [sharpness " + res.score0 + (res.fixed ? " \u2192 " + res.score : "") + "]" : "";
    if (parts.length) { st.textContent = parts.join(" ") + dbg; st.className = "pstat warn"; }
    else { st.textContent = "\u2713 Photo accepted with a white background. Please check that it matches the requirements above." + dbg; st.className = "pstat ok"; }
  });
}

// Returns {err} or {row, file}. Age/category mismatch is never an error.
function collect() {
  const v = id => $(id).value.trim().replace(/\s+/g, " ");
  const first = v("first"), mid = v("middle"), last = v("last"), suf = v("suffix");
  const bad = s => !s || /^(n\/?a|-+|\.+)$/i.test(s);
  if (bad(first)) return { err: "Please enter your first name." };
  if (bad(mid)) return { err: "Please enter your middle name (\"N/A\", \"-\" or \".\" are not accepted)." };
  if (bad(last)) return { err: "Please enter your last name." };
  const age = ageOf($("dob").value);
  if (age == null || age < 1 || age > 120) return { err: "Please enter a valid date of birth (age 1 to 120)." };
  if (!$("gender").value) return { err: "Please choose your gender." };
  if (!CIVIL.includes($("civil").value)) return { err: "Please choose your civil status." };
  if (!curCat()) return { err: "Please choose a category." };
  if (!$("center").value) return { err: "Please choose your center." };
  const gift = v("gift");
  if (!gift) return { err: "Please choose your spiritual gift (choose \"None\" if you prefer not to name one)." };
  if (v("address").length < 3) return { err: "Please enter your address." };
  const email = v("email"), tel = v("contact");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { err: "Please enter a valid email address." };
  if (tel && !/^[0-9+()\-\s]{7,20}$/.test(tel)) return { err: "Please enter a valid contact number." };
  if (photoBusy) return { err: "Please wait a moment: your photo is still being prepared." };
  const file = $("photo").files[0];
  if (!file || !photoOk || !photoBlob) return { err: "Profile photo is required. Please upload a clear 1x1 or passport-size photo." };
  if (!$("idconfirm").checked) return { err: "Please confirm that your photo is a school-ID style photo." };
  return { file, row: {
    first_name: first, middle_name: mid, last_name: last + (suf ? " " + suf : ""),
    full_name: [first, mid, last, suf].filter(Boolean).join(" "),
    date_of_birth: $("dob").value, gender: $("gender").value, civil_status: $("civil").value,
    category: curCat(), age, center: $("center").value, position: "Member",
    spiritual_gift: gift, contact_number: tel || null, email: email || null, address: v("address"),
    is_officer: false } };
}

// extra(): optional extra validation -> {err} or object; save(row, extra): does the DB work
function wireForm(extra, save) {
  let busy = false;
  $("f").addEventListener("submit", async e => {
    e.preventDefault();
    if (busy || !db) return;
    if ($("hp_field").value) { say("Thank you! Your registration was received.", "ok"); return; } // bot trap
    const c = collect(); if (c.err) return say(c.err, "err");
    const x = extra ? extra() : {}; if (x.err) return say(x.err, "err");
    if (!navigator.onLine) return say("No internet connection. Check your signal and try again.", "err");
    busy = true; $("btn").disabled = true; let path = null;
    try {
      say("Checking…");
      // The database also refuses blocked people. If is_blocked() is missing (older database) this check is skipped.
      const bl = await db.rpc("is_blocked", { p_name: c.row.full_name, p_dob: c.row.date_of_birth });
      if (!bl.error && bl.data === true) throw new Error("BLOCKED");
      const blob = photoBlob; // white-background JPEG made when the photo was chosen
      if (!blob) throw new Error("FRIENDLY:This photo could not be read. Please try another photo.");
      say("Uploading…");
      path = uid() + ".jpg";
      let up = await db.storage.from("member-photos").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) { say("Uploading again…"); path = uid() + ".jpg"; up = await db.storage.from("member-photos").upload(path, blob, { contentType: "image/jpeg" }); }
      if (up.error) { console.error(up.error); path = null; throw new Error("FRIENDLY:The photo could not be uploaded. Check your signal and try again, or choose a smaller photo."); }
      c.row.photo_path = path;
      say("Saving…");
      await save(c.row, x);
      const name = c.row.full_name;
      $("f").reset(); touched = false; $("preview").style.display = "none"; $("pstat").textContent = ""; photoOk = false; photoBlob = null; refresh();
      say("Thank you! " + name + " is registered. You can fill out the form again for another person.", "ok");
      $("msg").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      if (path) db.storage.from("member-photos").remove([path]).catch(() => {}); // best effort (may be blocked for anon)
      say(friendly(err), "err");
    } finally { busy = false; $("btn").disabled = false; }
  });
}
