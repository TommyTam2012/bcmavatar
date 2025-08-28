// ===============================
// main.js  (type="module")
// ===============================

// --- Optional fetch shim (routes SDK calls to your backend proxy) ---
(() => {
  const DISABLE_SHIM = (import.meta?.env?.VITE_DISABLE_HEYGEN_SHIM || "") === "1";
  if (DISABLE_SHIM) return;

  const ORIG_FETCH = window.fetch;
  window.fetch = async (input, init = {}) => {
    try {
      let url = typeof input === "string" ? input : input?.url;
      if (url && url.startsWith("https://api.heygen.com/v1/")) {
        const subpath = url.slice("https://api.heygen.com/v1/".length);
        const base = (import.meta?.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com")
          .replace(/\/$/, "");
        input = `${base}/heygen/proxy/${subpath}`; // backend injects HEYGEN_API_KEY
      }
    } catch (err) {
      console.warn("[Shim] fetch override error:", err);
    }
    return ORIG_FETCH(input, init);
  };
})();

// --- SDK import (still used for legacy token flow) ---
import StreamingAvatar, {
  StreamingEvents,
  TaskType,
  AvatarQuality,
} from "@heygen/streaming-avatar";

// ---- CONFIG ----
const BACKEND_BASE =
  (import.meta.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com").replace(/\/$/, "");

const AVATAR_ID = import.meta.env?.VITE_AVATAR_ID || "0d3f35185d7c4360b9f03312e0264d59";

// ---- DOM ----
const videoEl  = document.getElementById("avatarVideo");
const startBtn = document.getElementById("startSession");
const endBtn   = document.getElementById("endSession");
const speakBtn = document.getElementById("speakButton");
const inputEl  = document.getElementById("userInput");

// ---- STATE ----
let avatar = null;          // legacy SDK object (token flow)
let pc = null;              // WebRTC PeerConnection (new flow)
let currentSessionId = "";  // for streaming.start / streaming.task

// ---- HELPERS ----
async function getSessionOffer() {
  const res = await fetch(`${BACKEND_BASE}/heygen/token`, {
    method: "POST",
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token fetch failed: ${res.status} ${text}`);
  }
  const data = await res.json();

  // Legacy shape (old SDK)
  if (data?.session_token || data?.token) {
    return { type: "token", token: data.session_token || data.token };
  }

  // New WebRTC shape
  if (data?.data?.session_id && data?.data?.sdp) {
    return {
      type: "webrtc",
      session_id: data.data.session_id,
      sdp: data.data.sdp,
    };
  }

  throw new Error("Unexpected HeyGen response: " + JSON.stringify(data));
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
    const offer = await getSessionOffer();

    if (offer.type === "token") {
      // --- Legacy token flow ---
      avatar = new StreamingAvatar({
        token: offer.token,
        avatarId: AVATAR_ID,
        videoElement: videoEl,
      });

      avatar.on(StreamingEvents.STREAM_READY, () => {
        console.log("✅ Avatar STREAM_READY (legacy)");
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

    } else if (offer.type === "webrtc") {
      // --- New WebRTC flow ---
      console.log("✅ Got WebRTC offer from backend:", offer);
      currentSessionId = offer.session_id;

      // 1) Create PeerConnection
      pc = new RTCPeerConnection();

      // 2) Attach remote media to <video>
      pc.ontrack = (event) => {
        console.log("🎥 Remote track received:", event.streams);
        if (videoEl) videoEl.srcObject = event.streams[0];
      };

      // 3) Add local mic (optional)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 4) SDP handshake (browser side)
      await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // NOTE: There is no /streaming.answer endpoint. Start the session via streaming.start.
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

    // Legacy
    await avatar?.stop();
    avatar = null;

    // WebRTC
    if (pc) {
      pc.close();
      pc = null;
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
      // Legacy token flow
      await avatar.speak({ taskType: TaskType.TALK, text });
    } else if (currentSessionId) {
      // WebRTC flow — correct payload for streaming.task
      const r = await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: currentSessionId,
          text,                 // required
          task_type: "repeat",  // or "chat" if you configured a KB in streaming.new
          // task_mode: "sync",  // optional
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

// Enter to speak
inputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") speakBtn?.click();
});

// Initial UI state
setButtons({ starting: false, ready: false });
