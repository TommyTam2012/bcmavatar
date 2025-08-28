// ===============================
// main.js  (type="module")
// ===============================

// --- Optional fetch shim (routes SDK calls to your backend proxy) ---
// Leave ON if your backend implements /heygen/proxy/*
// Turn OFF by setting VITE_DISABLE_HEYGEN_SHIM="1"
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

// --- SDK import AFTER shim is installed ---
import StreamingAvatar, { StreamingEvents, TaskType } from "@heygen/streaming-avatar";

// ---- CONFIG ----
const BACKEND_BASE =
  (import.meta.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com").replace(/\/$/, "");

// ✅ Alessandra (Professional Look) avatar_id (from Labs Network response)
// You can override via env: VITE_AVATAR_ID
const AVATAR_ID =
  import.meta.env?.VITE_AVATAR_ID || "0d3f35185d7c4360b9f03312e0264d59";

// ---- DOM ----
const videoEl  = document.getElementById("avatarVideo");
const startBtn = document.getElementById("startSession");
const endBtn   = document.getElementById("endSession");
const speakBtn = document.getElementById("speakButton");
const inputEl  = document.getElementById("userInput");

// ---- STATE ----
let avatar = null;

// ---- HELPERS ----
async function getSessionToken() {
  const res = await fetch(`${BACKEND_BASE}/heygen/token`, {
    method: "POST",
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token fetch failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const token = data?.session_token || data?.token;
  if (!token) throw new Error("No session_token in backend response");
  return token;
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

    const token = await getSessionToken();

    avatar = new StreamingAvatar({
      token,
      avatarId: AVATAR_ID,
      videoElement: videoEl,
    });

    avatar.on(StreamingEvents.READY, () => {
      console.log("✅ Avatar READY");
      // Allow audio after explicit user action
      if (videoEl) videoEl.muted = false;
      setButtons({ starting: false, ready: true });
    });

    avatar.on(StreamingEvents.ERROR, (e) => {
      console.error("Streaming ERROR:", e);
      alert("Avatar error. Check console for details.");
      setButtons({ starting: false, ready: false });
    });

    await avatar.start(); // Connects & renders
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

// ---- Optional: auto-wire Enter key on input ----
inputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") speakBtn?.click();
});

// ---- Initial UI state ----
setButtons({ starting: false, ready: false });
