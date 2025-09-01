// ===============================
// main.js (LiveKit + TALK + API router)
// ===============================

import { Room, RoomEvent } from "livekit-client";

const BACKEND_BASE =
  (import.meta.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com").replace(/\/$/, "");

const videoEl = document.getElementById("avatarVideo");
const startBtn = document.getElementById("startSession");
const endBtn   = document.getElementById("endSession");
const speakBtn = document.getElementById("speakButton");
const inputEl  = document.getElementById("userInput");

let lkRoom = null;
let currentSessionId = "";

// ---------- Core session helpers ----------
async function fetchSession() {
  const res = await fetch(`${BACKEND_BASE}/heygen/token`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  const body = await res.json();
  if (body?.data?.session_id && body?.data?.url && body?.data?.access_token) return body.data;
  throw new Error("Invalid /heygen/token response: " + JSON.stringify(body));
}
function setButtons({ starting = false, ready = false }) {
  if (startBtn) startBtn.disabled = starting || ready;
  if (endBtn)   endBtn.disabled   = !ready;
  if (speakBtn) speakBtn.disabled = !ready;
}
async function say(text) {
  if (!currentSessionId) return;
  await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: currentSessionId, text, task_type: "talk" }),
  });
}

// ---------- API fetchers (SQLite via FastAPI) ----------
async function getFees(plan) {
  // e.g. GI or HKDSE (matches your /fees/{program_code})
  const r = await fetch(`${BACKEND_BASE}/fees/${encodeURIComponent(plan)}`);
  if (!r.ok) throw new Error("fees API failed");
  const j = await r.json();
  // Expecting: { program, fee, currency }
  return `${j.program} costs ${j.currency} ${j.fee}.`;
}
async function getSchedule(season = "summer") {
  const r = await fetch(`${BACKEND_BASE}/schedule?season=${encodeURIComponent(season)}`);
  if (!r.ok) throw new Error("schedule API failed");
  const arr = await r.json(); // [{course,weeks,days}] or []
  if (!Array.isArray(arr) || arr.length === 0) return `No schedule found for ${season}.`;
  const s = arr[0];
  const days = Array.isArray(s.days) ? s.days.join(", ") : s.days;
  return `${s.course}: ${s.weeks} weeks, days: ${days}.`;
}
async function getCoursesSummary() {
  // Try a friendly summary endpoint if you have it; else fall back to /courses list
  let text = "";
  try {
    const r1 = await fetch(`${BACKEND_BASE}/courses/summary`);
    if (r1.ok) {
      const j1 = await r1.json();
      if (j1?.summary) return j1.summary;
    }
  } catch {}
  // Fallback: /courses -> pick latest
  const r2 = await fetch(`${BACKEND_BASE}/courses`);
  if (!r2.ok) throw new Error("courses API failed");
  const list = await r2.json();
  if (!Array.isArray(list) || list.length === 0) return "We currently have no courses listed.";
  const c = list[0];
  text = `Latest course: ${c.name}, fee ${c.fee}.`;
  if (c.start_date && c.end_date) text += ` Runs ${c.start_date} to ${c.end_date}.`;
  if (c.time)  text += ` Time: ${c.time}.`;
  if (c.venue) text += ` Venue: ${c.venue}.`;
  return text;
}

// ---------- Keyword router ----------
async function handleUserQuery(raw) {
  const q = (raw || "").trim();
  if (!q) return;

  // Fees: “fee”, “price”, “cost” + plan code GI/HKDSE
  const feeMatch = q.match(/\b(fee|price|cost)\b.*\b(GI|HKDSE)\b/i);
  if (feeMatch) {
    const plan = feeMatch[2].toUpperCase();
    try { return await getFees(plan); } catch { return "Sorry, fees are unavailable right now."; }
  }

  // Schedule: “schedule” or “time(s)” or season mention
  const schedMatch = q.match(/\b(schedule|time|times|timetable)\b/i) || q.match(/\b(summer|winter|spring|fall)\b/i);
  if (schedMatch) {
    const season = (q.match(/\b(summer|winter|spring|fall)\b/i)?.[1] || "summer").toLowerCase();
    try { return await getSchedule(season); } catch { return "Sorry, schedule is unavailable right now."; }
  }

  // Courses
  if (/\bcourse(s)?\b/i.test(q)) {
    try { return await getCoursesSummary(); } catch { return "Sorry, course info is unavailable right now."; }
  }

  // Default: echo user text as TTS (no KB lookup)
  return q;
}

// ---------- UI wiring ----------
startBtn?.addEventListener("click", async () => {
  try {
    setButtons({ starting: true, ready: false });

    // 1) Create session + 2) Start
    const session = await fetchSession();
    currentSessionId = session.session_id;
    const startRes = await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: currentSessionId }),
    });
    if (!startRes.ok) throw new Error(await startRes.text());
    console.log("✅ streaming.start OK");

    // 3) LiveKit connect
    const room = new Room();
    lkRoom = room;

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      console.log("LiveKit state:", state);
    });

    room.on(RoomEvent.TrackSubscribed, (track) => {
      try {
        console.log("Track subscribed:", track.kind);
        if (track.kind === "video" && track.mediaStreamTrack) {
          videoEl.srcObject = new MediaStream([track.mediaStreamTrack]);
          videoEl.muted = false;
          videoEl.play().catch(err => console.warn("Video autoplay blocked:", err));
        }
        if (track.kind === "audio" && track.mediaStreamTrack) {
          const audioEl = document.createElement("audio");
          audioEl.srcObject = new MediaStream([track.mediaStreamTrack]);
          audioEl.autoplay = true;
          audioEl.play().catch(err => console.warn("Audio autoplay blocked:", err));
          console.log("✅ Audio track attached");
        }
      } catch (e) {
        console.error("TrackSubscribed handler error:", e);
      }
    });

    await room.connect(session.url, session.access_token);
    console.log("✅ Connected to LiveKit");

    // (Optional) Force intro line to bypass KB
    await say("Hello, I am your BCM assistant. Ask me about GI fees, summer schedule, or our latest courses.");

    setButtons({ starting: false, ready: true });
  } catch (err) {
    console.error("Failed to start session:", err);
    alert("Start failed — see console.");
    setButtons({ starting: false, ready: false });
  }
});

endBtn?.addEventListener("click", async () => {
  try {
    setButtons({ starting: false, ready: false });
    if (lkRoom) { await lkRoom.disconnect(); lkRoom = null; }
    currentSessionId = "";
    if (videoEl) { videoEl.srcObject = null; videoEl.removeAttribute("src"); videoEl.load(); }
  } catch (err) {
    console.error("End failed:", err);
  } finally {
    if (startBtn) startBtn.disabled = false;
  }
});

speakBtn?.addEventListener("click", async () => {
  try {
    const userText = (inputEl?.value || "").trim();
    if (!userText || !currentSessionId) return;
    const reply = await handleUserQuery(userText);
    await say(reply);
    if (inputEl) inputEl.value = "";
  } catch (err) {
    console.error("Speak failed:", err);
  }
});

// Enter to speak
inputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") speakBtn?.click();
});

// Init
setButtons({ starting: false, ready: false });
