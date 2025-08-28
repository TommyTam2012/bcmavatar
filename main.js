Please confirm the main.js code capt.  // ===============================
// main.js
// ===============================

// --- Fetch shim: intercept HeyGen API calls BEFORE SDK loads ---
// We do NOT send any admin key from the browser.
// All SDK calls to https://api.heygen.com/v1/* are routed to our backend proxy.
const ORIG_FETCH = window.fetch;
window.fetch = async (input, init = {}) => {
  try {
    let url = typeof input === "string" ? input : input?.url;

    if (url && url.startsWith("https://api.heygen.com/v1/")) {
      const subpath = url.slice("https://api.heygen.com/v1/".length);
      const base = (import.meta?.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com")
        .replace(/\/$/, "");
      input = `${base}/heygen/proxy/${subpath}`;
      // Backend proxy will inject HEYGEN_API_KEY
    }
  } catch (err) {
    console.warn("[Shim] fetch override error:", err);
  }
  return ORIG_FETCH(input, init);
};

// --- Main app: load SDK only AFTER shim is installed ---
import StreamingAvatar, { StreamingEvents, TaskType } from "@heygen/streaming-avatar";

// ---- CONFIG ----
const BACKEND_BASE =
  (import.meta.env?.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com").replace(/\/$/, "");

// ✅ Alessandra (Professional Look) avatar ID
const AVATAR_ID = "0d3f35185d7c4360b9f03312e0264d59";

// ---- DOM ----
const videoEl   = document.getElementById("avatarVideo");
const startBtn  = document.getElementById("startSession");
const endBtn    = document.getElementById("endSession");
const speakBtn  = document.getElementById("speakButton");
const inputEl   = document.getElementById("userInput");

// ---- STATE ----
let avatar = null;

// ---- HELPERS ----
async function getSessionToken() {
  const res = await fetch(`${BACKEND_BASE}/heygen/token`, { method: "POST", cache: "no-store" });
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
  const { session_token } = await res.json();
  if (!session_token) throw new Error("No session_token in backend response");
  return session_token;
}

// ---- LIFECYCLE ----
startBtn?.addEventListener("click", async () => {
  try {
    startBtn.disabled = true;

    const token = await getSessionToken();

    avatar = new StreamingAvatar({
      token,
      avatarId: AVATAR_ID,
      videoElement: videoEl,
    });

    avatar.on(StreamingEvents.READY, () => {
      console.log("✅ Avatar READY");
      endBtn.disabled = false;
      speakBtn.disabled = false;
      if (videoEl) videoEl.muted = false; // allow audio once user clicked Start
    });

    await avatar.start();
  } catch (err) {
    console.error("Failed to start session:", err);
    startBtn.disabled = false;
    alert("Start failed. Check console for details.");
  }
});

endBtn?.addEventListener("click", async () => {
  try {
    endBtn.disabled = true;
    speakBtn.disabled = true;
    await avatar?.stop();
    avatar = null;
    startBtn.disabled = false;
    if (videoEl) videoEl.srcObject = null;
  } catch (err) {
    console.error("End failed:", err);
  }
});

speakBtn?.addEventListener("click", async () => {
  try {
    const text = (inputEl?.value || "Hi, I’m Alessandra.").trim();
    if (!text) return;
    await avatar?.speak({ taskType: TaskType.TALK, text });
    inputEl.value = "";
  } catch (err) {
    console.error("Speak failed:", err);
  }
});
