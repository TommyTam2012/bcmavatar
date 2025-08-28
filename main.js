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
        input = `${base}/heygen/proxy/${subpath}`;
      }
    } catch (err) {
      console.warn("[Shim] fetch override error:", err);
    }
    return ORIG_FETCH(input, init);
  };
})();

// --- SDK import (still used for token flow) ---
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
let avatar = null;
let pc = null;             // WebRTC PeerConnection (for new flow)
let currentSessionId = ""; // track session_id for speak requests

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

  if (data?.session_token || data?.token) {
    return { type: "token", token: data.session_token || data.token };
  }
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
      // --- Legacy flow (session_token) ---
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

      // 1. Create PeerConnection
      pc = new RTCPeerConnection();

      // 2. Remote track (video/audio from HeyGen)
      pc.ontrack = (event) => {
        console.log("🎥 Remote track received:", event.streams);
        if (videoEl) videoEl.srcObject = event.streams[0];
      };

      // 3. Local mic (optional: capture mic input)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 4. Set remote description from HeyGen offer
      await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));

      // 5. Create & set local answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // 6. Send answer back to HeyGen
      await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: offer.session_id,
          sdp: pc.localDescription,
        }),
      });

      console.log("✅ Sent WebRTC answer to HeyGen");
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
    await avatar?.stop();
    avatar = null;

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
    } else if (pc && currentSessionId) {
      // WebRTC flow: POST speak task directly
      await fetch(`${BACKEND_BASE}/heygen/proxy/streaming.task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: currentSessionId,
          task: {
            type: "talk",
            text,
          },
        }),
      });
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
