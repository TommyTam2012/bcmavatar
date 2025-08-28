// ===============================
// main.js (final, LiveKit v2 flow)
// ===============================

import { Room, RoomEvent, ConnectionState } from "livekit-client";

// ---- CONFIG ----
const BACKEND_BASE =
  (import.meta.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com").replace(/\/$/, "");

// ---- DOM ----
const videoEl = document.getElementById("avatarVideo");
const startBtn = document.getElementById("startSession");
const endBtn = document.getElementById("endSession");
const speakBtn = document.getElementById("speakButton");
const inputEl = document.getElementById("userInput");

// ---- STATE ----
let lkRoom = null;
let currentSessionId = "";

// ---- HELPERS ----
async function fetchSession() {
  const res = await fetch(`${BACKEND_BASE}/heygen/token`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  const body = await res.json();
  if (body?.data?.session_id && body?.data?.url && body?.data?.access_token) {
    return body.data;
  }
  throw new Error("Invalid /heygen/token response: " + JSON.stringify(body));
}

function setButtons({ starting = false, ready = false }) {
  if (startBtn) startBtn.disabled = starting || ready;
  if (endBtn) endBtn.disabled = !ready;
  if (speakBtn) speakBtn.disabled = !ready;
}

// ---- LIFECYCLE ----
startBtn?.addEventListener("click", async () => {
  try {
    setButtons({ starting: true, ready: false });

    // 1) Create session
    const session = await fetchSession();
    currentSessionId = session.session_id;

    // 2) Start avatar session first
    const startRes = await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: currentSessionId }),
    });
    if (!startRes.ok) throw new Error(await startRes.text());
    console.log("✅ streaming.start OK");

    // 3) Join LiveKit room
    lkRoom = new Room();

    // Connection state logs (optional)
    lkRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
      console.log("LiveKit state:", state);
    });

    // SAFEST: use the track argument itself (no map iteration)
    lkRoom.on(RoomEvent.TrackSubscribed, (track /*, publication, participant */) => {
      try {
        if (track && track.mediaStreamTrack) {
          const ms = new MediaStream([track.mediaStreamTrack]);
          if (videoEl) {
            videoEl.srcObject = ms;
          }
        }
      } catch (e) {
        console.error("TrackSubscribed handler error:", e);
      }
    });

    // Optional: clean up when a track is removed
    lkRoom.on(RoomEvent.TrackUnsubscribed, () => {
      try {
        if (videoEl) {
          videoEl.srcObject = null;
        }
      } catch {}
    });

    await lkRoom.connect(session.url, session.access_token);
    console.log("✅ Connected to LiveKit");

    if (videoEl) videoEl.muted = false;
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

    if (lkRoom) {
      await lkRoom.disconnect();
      lkRoom = null;
    }
    currentSessionId = "";

    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.removeAttribute("src");
      videoEl.load();
    }
  } catch (err) {
    console.error("End failed:", err);
  } finally {
    if (startBtn) startBtn.disabled = false;
  }
});

speakBtn?.addEventListener("click", async () => {
  try {
    const text = (inputEl?.value || "Hello, Captain.").trim();
    if (!text || !currentSessionId) return;

    const r = await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: currentSessionId,
        text,
        task_type: "repeat", // or "chat"
      }),
    });
    if (!r.ok) throw new Error(await r.text());

    if (inputEl) inputEl.value = "";
  } catch (err) {
    console.error("Speak failed:", err);
  }
});

// Enter key triggers speak
inputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") speakBtn?.click();
});

// Init state
setButtons({ starting: false, ready: false });
