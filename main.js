// ===============================
// main.js  (type="module")
// ===============================

// --- Optional fetch shim for proxying HeyGen calls via backend ---
(() => {
  const DISABLE_SHIM = (import.meta?.env?.VITE_DISABLE_HEYGEN_SHIM || "") === "1";
  if (DISABLE_SHIM) return;
  const ORIG_FETCH = window.fetch;
  window.fetch = async (input, init = {}) => {
    try {
      let url = typeof input === "string" ? input : input?.url;
      if (url && url.startsWith("https://api.heygen.com/v1/")) {
        const subpath = url.slice("https://api.heygen.com/v1/".length);
        const base = (import.meta?.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com").replace(/\/$/, "");
        input = `${base}/heygen/proxy/${subpath}`;
      }
    } catch (err) {
      console.warn("[Shim] fetch override error:", err);
    }
    return ORIG_FETCH(input, init);
  };
})();

// Legacy SDK (only used if session_token comes back)
import StreamingAvatar, { StreamingEvents, TaskType, AvatarQuality } from "@heygen/streaming-avatar";
// LiveKit v2 flow
import { Room, RoomEvent } from "livekit-client";

// ---- CONFIG ----
const BACKEND_BASE = (import.meta.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com").replace(/\/$/, "");
const AVATAR_ID = import.meta.env?.VITE_AVATAR_ID || "0d3f35185d7c4360b9f03312e0264d59";

// ---- DOM ----
const videoEl  = document.getElementById("avatarVideo");
const startBtn = document.getElementById("startSession");
const endBtn   = document.getElementById("endSession");
const speakBtn = document.getElementById("speakButton");
const inputEl  = document.getElementById("userInput");

// ---- STATE ----
let avatar = null;         // legacy
let lkRoom = null;         // LiveKit Room
let currentSessionId = "";

// ---- HELPERS ----
async function createSession() {
  const res = await fetch(`${BACKEND_BASE}/heygen/token`, { method: "POST", cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token fetch failed: ${res.status} ${text}`);
  }
  const data = await res.json();

  // Legacy token flow (unlikely now, but we keep it)
  if (data?.session_token || data?.token) {
    return { mode: "token", token: data.session_token || data.token };
  }

  // LiveKit v2 flow
  const s = data?.data;
  if (s?.session_id && s?.url && s?.access_token) {
    return { mode: "livekit", session_id: s.session_id, url: s.url, access_token: s.access_token };
  }

  throw new Error("Unexpected /heygen/token response: " + JSON.stringify(data));
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

    const sess = await createSession();

    if (sess.mode === "token") {
      // --- Legacy token flow ---
      avatar = new StreamingAvatar({
        token: sess.token,
        avatarId: AVATAR_ID,
        videoElement: videoEl,
      });

      avatar.on(StreamingEvents.STREAM_READY, () => {
        console.log("✅ STREAM_READY (legacy)");
        if (videoEl) videoEl.muted = false;
        setButtons({ starting: false, ready: true });
      });

      avatar.on(StreamingEvents.ERROR, (e) => {
        console.error("Streaming ERROR:", e);
        alert("Avatar error. Check console for details.");
        setButtons({ starting: false, ready: false });
      });

      await avatar.createStartAvatar({
        avatarName: AVATAR_ID,
        quality: AvatarQuality.High,
      });

    } else if (sess.mode === "livekit") {
      // --- LiveKit v2 flow ---
      currentSessionId = sess.session_id;

      // 1) Join LiveKit with provided url + access_token
      lkRoom = new Room();
      lkRoom.on(RoomEvent.TrackSubscribed, (_track, pub, participant) => {
        // When remote video track is available, attach to video element
        const mediaStream = new MediaStream();
        participant.tracks.forEach((p) => {
          const t = p.track;
          if (t && t.mediaStreamTrack) mediaStream.addTrack(t.mediaStreamTrack);
        });
        if (videoEl) videoEl.srcObject = mediaStream;
      });

      await lkRoom.connect(sess.url, sess.access_token);
      console.log("✅ LiveKit connected");

      // 2) Start the streaming session
      const startRes = await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: currentSessionId }),
      });
      if (!startRes.ok) {
        const t = await startRes.text().catch(() => "");
        throw new Error(`streaming.start failed: ${startRes.status} ${t}`);
      }
      console.log("✅ streaming.start OK");

      if (videoEl) videoEl.muted = false;
      setButtons({ starting: false, ready: true });
    }

  } catch (err) {
    console.error("Failed to start session:", err);
    alert("Start failed. Open DevTools → Console for details.");
    setButtons({ starting: false, ready: false });
  }
});

endBtn?.addEventListener("click", async () => {
  try {
    setButtons({ starting: false, ready: false });

    // Legacy stop
    await avatar?.stop();
    avatar = null;

    // LiveKit cleanup
    if (lkRoom) {
      await lkRoom.disconnect();
      lkRoom = null;
      currentSessionId = "";
    }

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
    const text = (inputEl?.value || "Hi, I’m Alessandra. How can I help?").trim();
    if (!text) return;

    if (avatar) {
      // Legacy SDK
      await avatar.speak({ taskType: TaskType.TALK, text });
    } else if (currentSessionId) {
      // LiveKit v2 — task API per docs
      const r = await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: currentSessionId,
          text,
          task_type: "repeat", // or "chat" if you configured KB in streaming.new
          // task_mode: "sync",
        }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`streaming.task failed: ${r.status} ${t}`);
      }
    }

    if (inputEl) inputEl.value = "";
  } catch (err) {
    console.error("Speak failed:", err);
  }
});

inputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") speakBtn?.click();
});

setButtons({ starting: false, ready: false });
