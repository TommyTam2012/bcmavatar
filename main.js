// ===============================
// main.js (LiveKit + TALK + BCM-only answers + Mic + Pause/Resume)
// ===============================

import { Room, RoomEvent } from "livekit-client";

const BACKEND_BASE =
  (import.meta.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com").replace(/\/$/, "");

const videoEl   = document.getElementById("avatarVideo");
const startBtn  = document.getElementById("startSession");
const endBtn    = document.getElementById("endSession");
const speakBtn  = document.getElementById("speakButton");
const micBtn    = document.getElementById("micButton");
const inputEl   = document.getElementById("userInput");
const pauseBtn  = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");

let lkRoom = null;
let currentSessionId = "";
let remoteAudioEl = null;

// Speech recognition state
let recognition = null;
let recognizing = false;
let interimTranscript = "";
let finalTranscript = "";

// ---------- Core helpers ----------
async function fetchSession() {
  const res = await fetch(`${BACKEND_BASE}/heygen/token`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  const body = await res.json();
  if (body?.data?.session_id && body?.data?.url && body?.data?.access_token) return body.data;
  throw new Error("Invalid /heygen/token response: " + JSON.stringify(body));
}

function setButtons({ starting = false, ready = false }) {
  if (startBtn)  startBtn.disabled  = starting || ready;
  if (endBtn)    endBtn.disabled    = !ready;
  if (speakBtn)  speakBtn.disabled  = !ready;
  if (micBtn)    micBtn.disabled    = !ready;
  // pause/resume will be enabled when audio track attaches
}

async function say(text) {
  if (!currentSessionId) return;
  const payload = { session_id: currentSessionId, text: (text || "").trim(), task_type: "talk" };
  if (!payload.text) return; // never send empty -> prevents model from asking questions
  await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function interruptSpeaking() {
  if (!currentSessionId) return;
  try {
    // Some providers ignore this; we still mute locally as a guarantee.
    await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: currentSessionId, text: ".", task_type: "talk" }),
    });
  } catch (e) {
    console.warn("interrupt attempt failed:", e);
  }
}

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.warn("SpeechRecognition not supported in this browser (HTTPS + Chrome/Edge recommended).");
    return null;
  }
  const rec = new SR();
  // Change language if you prefer (e.g., "zh-CN" for Mandarin, "yue-Hant-HK" for Cantonese)
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = true;

  rec.onstart = () => {
    recognizing = true;
    interimTranscript = "";
    finalTranscript = "";
    if (micBtn) micBtn.textContent = "🎙️ Release to send";
  };
  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += t;
      } else {
        interim += t;
      }
    }
    interimTranscript = interim;
    if (inputEl) inputEl.value = (finalTranscript + " " + interimTranscript).trim();
  };
  rec.onerror = (e) => {
    console.warn("SpeechRecognition error:", e);
  };
  rec.onend = () => {
    recognizing = false;
    if (micBtn) micBtn.textContent = "🎤 Hold to Speak";
  };
  return rec;
}

// ---------- Session wiring ----------
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
          // Attach remote audio and enable pause/resume
          if (remoteAudioEl) {
            try { remoteAudioEl.remove(); } catch {}
          }
          remoteAudioEl = document.createElement("audio");
          remoteAudioEl.srcObject = new MediaStream([track.mediaStreamTrack]);
          remoteAudioEl.autoplay = true;
          remoteAudioEl.muted = false;
          document.body.appendChild(remoteAudioEl);
          console.log("✅ Audio track attached");

          if (pauseBtn)  pauseBtn.disabled  = false;
          if (resumeBtn) resumeBtn.disabled = true;
        }
      } catch (e) {
        console.error("TrackSubscribed handler error:", e);
      }
    });

    await room.connect(session.url, session.access_token);
    console.log("✅ Connected to LiveKit");

    // BCM intro (always fixed; avoids KB)
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
    if (remoteAudioEl) {
      try { remoteAudioEl.remove(); } catch {}
      remoteAudioEl = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.removeAttribute("src");
      videoEl.load();
    }
    if (pauseBtn)  pauseBtn.disabled  = true;
    if (resumeBtn) resumeBtn.disabled = true;
  } catch (err) {
    console.error("End failed:", err);
  } finally {
    if (startBtn) startBtn.disabled = false;
  }
});

// ---------- Text send ----------
speakBtn?.addEventListener("click", async () => {
  try {
    let userText = (inputEl?.value || "").trim();
    if (!currentSessionId) return;
    if (!userText) return;

    // BCM-only backend call (hard rules + enrollment step)
    const r = await fetch(`${BACKEND_BASE}/assistant/answer`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ text: userText })
    });
    const j = await r.json();

    await say((j?.reply || "").trim());
    if (inputEl) inputEl.value = "";
  } catch (err) {
    console.error("Speak failed:", err);
  }
});

// ---------- Mic press-to-talk ----------
micBtn?.addEventListener("mousedown", async () => {
  try {
    if (!recognition) recognition = initSpeechRecognition();
    if (!recognition || recognizing) return;
    recognition.start();
  } catch (e) {
    console.warn("mic start failed:", e);
  }
});
micBtn?.addEventListener("mouseup", async () => {
  try {
    if (recognition && recognizing) recognition.stop();
    const userText = (inputEl?.value || "").trim();
    if (!userText || !currentSessionId) return;

    const r = await fetch(`${BACKEND_BASE}/assistant/answer`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ text: userText })
    });
    const j = await r.json();
    await say((j?.reply || "").trim());
    if (inputEl) inputEl.value = "";
  } catch (e) {
    console.warn("mic stop/send failed:", e);
  }
});
// Touch devices
micBtn?.addEventListener("touchstart", async (ev) => {
  ev.preventDefault();
  try {
    if (!recognition) recognition = initSpeechRecognition();
    if (!recognition || recognizing) return;
    recognition.start();
  } catch (e) {
    console.warn("mic touchstart failed:", e);
  }
}, { passive: false });
micBtn?.addEventListener("touchend", async (ev) => {
  ev.preventDefault();
  try {
    if (recognition && recognizing) recognition.stop();
    const userText = (inputEl?.value || "").trim();
    if (!userText || !currentSessionId) return;

    const r = await fetch(`${BACKEND_BASE}/assistant/answer`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ text: userText })
    });
    const j = await r.json();
    await say((j?.reply || "").trim());
    if (inputEl) inputEl.value = "";
  } catch (e) {
    console.warn("mic touchend/send failed:", e);
  }
}, { passive: false });

// ---------- Pause/Resume ----------
pauseBtn?.addEventListener("click", async () => {
  try {
    await interruptSpeaking(); // try to cut TTS server-side
    if (remoteAudioEl) {
      remoteAudioEl.muted = true; // guarantee silence client-side
      pauseBtn.disabled  = true;
      resumeBtn.disabled = false;
    }
  } catch (e) {
    console.warn("pause/interrupt failed:", e);
  }
});

resumeBtn?.addEventListener("click", () => {
  try {
    if (remoteAudioEl) {
      remoteAudioEl.muted = false;
      pauseBtn.disabled  = false;
      resumeBtn.disabled = true;
    }
  } catch (e) {
    console.warn("resume failed:", e);
  }
});

// ---------- Keyboard: Enter to send typed ----------
inputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") speakBtn?.click();
});

// ---------- Init ----------
setButtons({ starting: false, ready: false });
if (pauseBtn)  pauseBtn.disabled  = true;
if (resumeBtn) resumeBtn.disabled = true;
