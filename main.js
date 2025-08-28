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

// --- SDK import AFTER shim is installed ---
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

  // New shape (WebRTC offer)
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
      // --- Legacy flow ---
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

      // For now: just log it, since the StreamingAvatar SDK
      // may require a different init call for WebRTC negotiation.
      // Next step: call SDK's connect/answer method with offer.sdp.
      alert("WebRTC offer received (session_id). Need SDK handshake logic.");
      setButtons({ starting: false, ready: false });
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
    await avatar?.speak({ taskType: TaskType.TALK, text });
    if (inputEl) inputEl.value = "";
  } catch (err) {
    console.error("Speak failed:", err);
  }
});

inputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") speakBtn?.click();
});

setButtons({ starting: false, ready: false });
