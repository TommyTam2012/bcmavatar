// ===============================
// main.js (HeyGen Interactive style, fixed order)
// ===============================

import {
  AvatarQuality,
  StreamingEvents,
  VoiceEmotion,
  StartAvatarRequest,
  ElevenLabsModel,
} from "@heygen/streaming-avatar";

import { Room, RoomEvent } from "livekit-client";

// ---- CONFIG ----
const BACKEND_BASE =
  (import.meta.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com").replace(/\/$/, "");

// Use a valid Interactive Avatar ID from your HeyGen account
const AVATAR_ID =
  import.meta.env?.VITE_AVATAR_ID || "0d3f35185d7c4360b9f03312e0264d59";

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

    // 1. Create session via backend
    const session = await fetchSession();
    currentSessionId = session.session_id;

    // 2. Start the avatar session FIRST
    const startRes = await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: currentSessionId }),
    });
    if (!startRes.ok) throw new Error(await startRes.text());
    console.log("✅ streaming.start OK");

    // 3. Now join LiveKit room
    lkRoom = new Room();
    lkRoom.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
      const ms = new MediaStream();
      participant.tracks.forEach((p) => {
        if (p.track && p.track.mediaStreamTrack) {
          ms.addTrack(p.track.mediaStreamTrack);
        }
      });
      if (videoEl) videoEl.srcObject = ms;
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
    const text = (inputEl?.value || "Hello, I’m Alessandra.").trim();
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
