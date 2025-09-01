// ===============================
// main.js (LiveKit + TALK + BCM-only answers)
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

    // BCM intro (always fixed)
    try {
      const r = await fetch(`${BACKEND_BASE}/assistant/intro`);
      const j = await r.json();
      await say(j.intro || "Hello, I’m the BCM assistant.");
    } catch {
      await say("Hello, I’m the BCM assistant.");
    }

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
    let userText = (inputEl?.value || "").trim();
    if (!currentSessionId) return;
    if (!userText) {
      // never send empty/space-only tasks to HeyGen (prevents agent-like behavior)
      return;
    }

    // BCM-only backend call
    const r = await fetch(`${BACKEND_BASE}/assistant/answer`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ text: userText })
    });
    const j = await r.json();

    // Force talk-only task (no agent), so avatar just speaks our reply
    await say((j?.reply || "").trim());

    if (inputEl) inputEl.value = "";
  } catch (err) {
    console.error("Speak failed:", err);
  }
});


// Enter to speak (keyboard)
inputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") speakBtn?.click();
});

// Init
setButtons({ starting: false, ready: false });
