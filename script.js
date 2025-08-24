/* ===========================
   BCM Avatar Frontend Bridge
   - Host: Vercel (static)
   - Backend: FastAPI on Render
   - Exposes window.BCM{...}
   =========================== */

console.log("[BCM] bridge loaded");

/** ========= CONFIG ========= **/
let API_BASE = "https://bcm-demo.onrender.com";   // change if needed
let ADMIN_KEY = undefined;                         // set via BCM.setAdminKey()

/** ========= UTILS ========= **/
const DEFAULT_TIMEOUT_MS = 12000;

function withTimeout(ms, signal) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new Error("Timeout")), ms);
  const combined = signal ? new AbortController() : null;

  if (signal && combined) {
    const onAbort = () => combined.abort(signal.reason || new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: combined ? combined.signal : ctrl.signal,
    clear: () => clearTimeout(id),
    controller: ctrl
  };
}

async function httpGet(path, { timeout = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const t = withTimeout(timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      signal: t.signal
    });
    const contentType = res.headers.get("content-type") || "";
    let data = null;
    if (contentType.includes("application/json")) {
      data = await res.json();
    } else {
      data = await res.text();
    }
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${res.statusText}`);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    t.clear();
  }
}

async function httpPost(path, body, { timeout = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const t = withTimeout(timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body || {}),
      signal: t.signal
    });
    const contentType = res.headers.get("content-type") || "";
    let data = null;
    if (contentType.includes("application/json")) {
      data = await res.json();
    } else {
      data = await res.text();
    }
    if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${res.statusText}`);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    t.clear();
  }
}

/** ====== TEXT HELPERS ====== **/
function coursesToText(data) {
  if (!data || !Array.isArray(data.courses)) return "No courses available at the moment.";
  const lines = data.courses.map(c => c.summary || JSON.stringify(c));
  return lines.length ? lines.join("\n") : "No courses available at the moment.";
}

function faqsToText(data) {
  if (!Array.isArray(data) || !data.length) return "No FAQs available right now.";
  return data.map(f => `${f.question}: ${f.answer}`).join("\n");
}

function enrollmentsToText(data) {
  if (!Array.isArray(data) || !data.length) return "No recent enrollments.";
  return data.map(e => `${e.full_name} enrolled in ${e.program_code || "a course"} on ${e.created_at}`).join("\n");
}

/** ===== PUBLIC API (STRUCTURED) ===== **/
async function fetchCourses() {
  const res = await httpGet("/courses/summary/all");
  return res.ok ? res : { ok: false, error: "Live system is unreachable. Please try again later." };
}

async function fetchFaqs() {
  const res = await httpGet("/faqs");
  return res.ok ? res : { ok: false, error: "FAQs are not available right now." };
}

async function fetchRecentEnrollments(limit = 10, source) {
  const headers = {};
  if (ADMIN_KEY) headers["X-Admin-Key"] = ADMIN_KEY;

  const q = new URLSearchParams();
  if (limit) q.set("limit", String(limit));
  if (source) q.set("source", String(source));

  const path = `/enrollments/recent${q.toString() ? `?${q.toString()}` : ""}`;
  const res = await httpGet(path, { headers });
  return res.ok ? res : { ok: false, error: "Unable to retrieve recent enrollments." };
}

async function createEnrollment(payload) {
  const res = await httpPost("/enroll", payload);
  return res.ok ? res : { ok: false, error: "Unable to create enrollment. Please try again." };
}

async function pingHealth() {
  return httpGet("/health");
}
async function fetchHeygenToken() {
  const headers = {};
  if (ADMIN_KEY) headers["X-Admin-Key"] = ADMIN_KEY;
  return httpPost("/heygen/token", {}, { headers });
}
/** ===== PUBLIC API (READABLE TEXT) ===== **/
async function fetchCoursesText() {
  const r = await fetchCourses();
  if (!r.ok) return "Sorry, my live system is unreachable. Please try again later.";
  return coursesToText(r.data);
}

async function fetchFaqsText() {
  const r = await fetchFaqs();
  if (!r.ok) return "Sorry, FAQs are not available right now.";
  return faqsToText(r.data);
}

async function fetchRecentEnrollmentsText(limit = 10, source) {
  const r = await fetchRecentEnrollments(limit, source);
  if (!r.ok) return "Sorry, I can’t retrieve recent enrollments right now.";
  return enrollmentsToText(r.data);
}

/** ===== FALLBACK CHAT/ROUTER ===== **/
async function askBackend(utterance) {
  const u = String(utterance || "").toLowerCase();
  if (u.includes("course")) return { ok: true, data: await fetchCoursesText() };
  if (u.includes("faq"))    return { ok: true, data: await fetchFaqsText() };
  const res = await httpPost("/chat", { message: utterance });
  if (!res.ok) return { ok: false, error: "Chat service is unavailable." };
  return res;
}

/** ===== EXPOSE TO WINDOW ===== **/
window.BCM = {
  setApiBase: (url) => { API_BASE = String(url || API_BASE); },
  getApiBase: () => API_BASE,
  setAdminKey: (key) => { ADMIN_KEY = key || undefined; },

  fetchCourses,
  fetchFaqs,
  fetchRecentEnrollments,
  createEnrollment,
  pingHealth,
  askBackend,

  fetchCoursesText,
  fetchFaqsText,
  fetchRecentEnrollmentsText,

  // NEW: expose Heygen token fetch
  fetchHeygenToken
};
console.log("[BCM] bridge ready", typeof window.BCM);
