// ===============================
// main.js (final patched: audio + TALK + mic STT)
// ===============================

import { Room, RoomEvent } from "livekit-client";

const BACKEND_BASE =
  (import.meta.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com").replace(/\/$/, "");

const videoEl = document.getElementById("avatarVideo");
const startBtn = document.getElementById("startSession");
const endBtn = document.getElementById("endSession");
const speakBtn = document.getElementById("speakButton");
const micBtn   = document.getElementById("micButton");
const inputEl  = document.getElementById("userInput");

let lkRoom = null;
let currentSessionId = "";

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
  if (micBtn) micBtn.disabled = !ready;
}

// ---- LIFECYCLE ----
startBtn?.addEventListener("click", async () => {
  try {
    setButtons({ starting: true, ready: false });
    const session = await fetchSession();
    currentSessionId = session.session_id;

    await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: currentSessionId }),
    });
    console.log("✅ streaming.start OK");

    lkRoom = new Room();
    lkRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
      console.log("LiveKit state:", state);
    });

    lkRoom.on(RoomEvent.TrackSubscribed, (track) => {
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
    });

    await lkRoom.connect(session.url, session.access_token);
    console.log("✅ Connected to LiveKit");

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
    videoEl.srcObject = null;
  } catch (err) {
    console.error("End failed:", err);
  } finally {
    if (startBtn) startBtn.disabled = false;
  }
});

speakBtn?.addEventListener("click", async () => {
  try {
    const text = (inputEl?.value || "").trim();
    if (!text || !currentSessionId) return;
    await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: currentSessionId,
        text,
        task_type: "talk",
      }),
    });
    inputEl.value = "";
  } catch (err) {
    console.error("Speak failed:", err);
  }
});

// ---- Mic / STT ----
micBtn?.addEventListener("click", async () => {
  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
    alert("Speech Recognition not supported in this browser.");
    return;
  }

  const Recog = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Recog();
  rec.lang = "en-US";
  rec.start();

  rec.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    console.log("🎤 Heard:", transcript);
    inputEl.value = transcript;

    // auto-send to avatar
    if (currentSessionId) {
      await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: currentSessionId,
          text: transcript,
          task_type: "talk",
        }),
      });
    }
  };

  rec.onerror = (event) => {
    console.error("STT error:", event.error);
  };
});

// Enter key triggers speak
inputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") speakBtn?.click();
});

// Init state
setButtons({ starting: false, ready: false });
