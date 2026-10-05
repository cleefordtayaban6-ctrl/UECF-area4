// Shared by member-form.html and officer-form.html
const $ = id => document.getElementById(id);
const CFG = window.APP_CONFIG || {};
const CENTERS = ["Puon ti Biag","Damasco","Ti libro a naselloan","Eufrates","Baro Jerusalem","Pergamo","Patmos","Raniag ti lawag","Galilea","Tesalonica","Galacia","Baro a langit","Getsemani"];
const SKIP = "Optional: you can skip this if you don't want to fill it in.";
const CIVIL = ["Single","Married","Separated","Widow (Woman)","Widower (Man)"];
const CATS = [["Junior FYS","Junior FYS (ages 7–12)"],["Senior FYS","Senior FYS (ages 13–30)"],["Katandaan","Katandaan / Elders (30+, or any married, separated or widowed person)"]];
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
  if (/DUPLICATE_EMAIL|members_email_name_uidx/.test(m) || (err && err.code === "23505")) return "This person is already registered (same name and email).";
  if (!navigator.onLine || /fetch|network/i.test(m)) return "No internet connection. Check your signal and try again.";
  return "Something went wrong. Please try again, or tell the admin.";
}
function compress(file) { // ~900px JPEG
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(u);
      const s = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b ? res(b) : rej(new Error("compress")), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("unreadable")); };
    img.src = u;
  });
}

let photoOk = false; // true only after the chosen photo passes the ID-style checks
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
  <label for="gift">Spiritual gift (optional)</label><input id="gift" maxlength="80" autocomplete="off"><small class="skip">${SKIP}</small>
  <label for="contact">Contact number (optional)</label><input id="contact" type="tel" maxlength="20" autocomplete="off"><small class="skip">${SKIP}</small>
  <label for="email">Email (optional)</label><input id="email" type="email" maxlength="120" autocomplete="off"><small class="skip">${SKIP}</small>
  <label for="address">Address *</label><input id="address" maxlength="200" autocomplete="off">
  <fieldset class="photo-card"><legend>Profile photo (ID-style) *</legend>
    <p class="ph-lead">Upload a photo like a <b>school ID or passport picture</b>. Casual, posed or Facebook-style pictures are not accepted.</p>
    <div class="ph-ex">
      <figure><svg viewBox="0 0 90 110" width="90" height="110" role="img" aria-label="Accepted: head and shoulders on a plain background"><rect width="90" height="110" rx="6" style="fill:var(--bg);stroke:var(--line)"/><circle cx="45" cy="42" r="19" style="fill:var(--mute)"/><path d="M12 110c2-26 17-38 33-38s31 12 33 38z" style="fill:var(--mute)"/></svg><figcaption class="ok">&#10003; Accepted</figcaption></figure>
      <figure><svg viewBox="0 0 90 110" width="90" height="110" role="img" aria-label="Not accepted: casual, wide or full-body photo with a busy background"><rect width="90" height="110" rx="6" style="fill:var(--bg);stroke:var(--line)"/><path d="M0 72l20-25 15 15 18-30 37 40v38H0z" style="fill:var(--line)"/><circle cx="62" cy="62" r="7" style="fill:var(--mute)"/><path d="M50 110c1-14 6-22 12-22s11 8 12 22z" style="fill:var(--mute)"/><path d="M10 10L80 100" style="stroke:var(--err);stroke-width:4"/></svg><figcaption class="bad">&#10007; Not accepted</figcaption></figure>
    </div>
    <ul class="req"><li>Plain, light background</li><li>Head and shoulders, facing the camera</li><li>Whole face clear, well lit, no filters</li><li>Only you in the photo; no hat or sunglasses</li></ul>
    <input id="photo" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose ID-style photo">
    <div id="pstat" class="pstat" role="status" aria-live="polite"></div>
    <img id="preview" alt="Photo preview">
    <label class="r"><input type="checkbox" id="idconfirm"> I confirm this is a recent school-ID style photo of myself.</label>
  </fieldset>
  <dialog id="tip"><h2 style="margin:0 0 8px;font-size:1.2rem">ID-style photo only</h2>
    <p>Choose a photo like a <b>school ID or passport picture</b>: plain background, head and shoulders, facing the camera, whole face clear.</p>
    <p><b>Not accepted:</b> casual or Facebook-style poses, selfies with filters, group or full-body shots, sunglasses or hats.</p>
    <button id="tipok" type="button">I understand, choose photo</button><button id="tipno" type="button" class="plain">Cancel</button></dialog>
  <div class="hp" aria-hidden="true"><label>Website <input id="website" tabindex="-1" autocomplete="off"></label></div>`;
  $("dob").max = new Date().toISOString().slice(0, 10);
  $("dob").oninput = $("dob").onchange = refresh;
  $("civil").onchange = () => { touched = false; refresh(); }; // civil status change re-suggests Katandaan
  document.querySelectorAll("input[name=cat]").forEach(r => r.onchange = () => { touched = true; refresh(); });
  let tipOk = false; // reminder shown every time
  $("photo").addEventListener("click", e => { if (tipOk) { tipOk = false; return; } e.preventDefault(); $("tip").showModal(); });
  $("tipok").onclick = () => { $("tip").close(); tipOk = true; $("photo").click(); };
  $("tipno").onclick = () => $("tip").close();
  let photoSeq = 0;
  // Automatic checks: format, size, portrait/square shape, and (where the browser supports it) face count and size.
  // These catch obvious non-ID photos; the admin can still review every photo.
  $("photo").addEventListener("change", async () => {
    const f = $("photo").files[0], p = $("preview"), st = $("pstat"), seq = ++photoSeq;
    say(""); photoOk = false; p.style.display = "none"; st.textContent = ""; st.className = "pstat";
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
    else if (window.FaceDetector) {
      try {
        const faces = await new FaceDetector({ fastMode: true, maxDetectedFaces: 5 }).detect(img);
        if (faces.length > 1) msg = "More than one face was detected. An ID photo must show only you.";
        else if (faces.length === 1 && faces[0].boundingBox.height / h < 0.2) msg = "Your face is too small in the photo. Move closer or crop to head and shoulders.";
        else if (!faces.length) note = "We could not clearly detect a face. Make sure your whole face is visible and well lit.";
      } catch (_) { /* detector unavailable: skip this check */ }
    }
    if (msg) { URL.revokeObjectURL(url); return fail(msg); }
    if (seq !== photoSeq) return URL.revokeObjectURL(url);
    p.src = url; p.style.display = "block"; photoOk = true;
    st.textContent = note || "\u2713 Photo accepted. Please check that it matches the requirements above.";
    st.className = "pstat " + (note ? "warn" : "ok");
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
  if (v("address").length < 3) return { err: "Please enter your address." };
  const email = v("email"), tel = v("contact");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { err: "Please enter a valid email address." };
  if (tel && !/^[0-9+()\-\s]{7,20}$/.test(tel)) return { err: "Please enter a valid contact number." };
  const file = $("photo").files[0];
  if (!file || !photoOk) return { err: "Profile photo is required. Please upload a clear 1x1 or passport-size photo." };
  if (!$("idconfirm").checked) return { err: "Please confirm that your photo is a school-ID style photo." };
  return { file, row: {
    first_name: first, middle_name: mid, last_name: last + (suf ? " " + suf : ""),
    full_name: [first, mid, last, suf].filter(Boolean).join(" "),
    date_of_birth: $("dob").value, gender: $("gender").value, civil_status: $("civil").value,
    category: curCat(), age, center: $("center").value, position: "Member",
    spiritual_gift: v("gift") || "None", contact_number: tel || null, email: email || null, address: v("address"),
    is_officer: false } };
}

// extra(): optional extra validation -> {err} or object; save(row, extra): does the DB work
function wireForm(extra, save) {
  let busy = false;
  $("f").addEventListener("submit", async e => {
    e.preventDefault();
    if (busy || !db) return;
    if ($("website").value) { say("Thank you! Your registration was received.", "ok"); return; } // bot trap
    const c = collect(); if (c.err) return say(c.err, "err");
    const x = extra ? extra() : {}; if (x.err) return say(x.err, "err");
    if (!navigator.onLine) return say("No internet connection. Check your signal and try again.", "err");
    busy = true; $("btn").disabled = true; let path = null;
    try {
      say("Preparing photo…");
      let blob; try { blob = await compress(c.file); } catch (_) { throw new Error("FRIENDLY:This photo could not be read. Please try another photo."); }
      say("Uploading…");
      path = uid() + ".jpg";
      const up = await db.storage.from("member-photos").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) { path = null; throw up.error; }
      c.row.photo_path = path;
      say("Saving…");
      await save(c.row, x);
      const name = c.row.full_name;
      $("f").reset(); touched = false; $("preview").style.display = "none"; $("pstat").textContent = ""; photoOk = false; refresh();
      say("Thank you! " + name + " is registered. You can fill out the form again for another person.", "ok");
      $("msg").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      if (path) db.storage.from("member-photos").remove([path]).catch(() => {}); // best effort (may be blocked for anon)
      say(friendly(err), "err");
    } finally { busy = false; $("btn").disabled = false; }
  });
}
