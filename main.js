// --- Fetch shim: intercept HeyGen API calls before SDK loads ---
const ORIG_FETCH = window.fetch;
window.fetch = async (input, init = {}) => {
  try {
    let url = typeof input === "string" ? input : input.url;

    if (url && url.startsWith("https://api.heygen.com/v1/")) {
      const subpath = url.slice("https://api.heygen.com/v1/".length);

      init = init || {};
      init.headers = {
        ...(init.headers || {}),
        "X-Admin-Key": import.meta.env.VITE_BCM_ADMIN_KEY, // must match backend ADMIN_KEY
      };

      url = `${import.meta.env.VITE_BACKEND_BASE}/heygen/proxy/${subpath}`;
      input = url;
    }
  } catch (err) {
    console.warn("[Shim] fetch override error:", err);
  }
  return ORIG_FETCH(input, init);
};

// --- Main app: load SDK only after shim is installed ---
(async () => {
  const {
    default: StreamingAvatar,
    AvatarQuality,
    StreamingEvents,
    TaskType,
  } = await import("@heygen/streaming-avatar");

  // ---- CONFIG ----
  const BACKEND_BASE =
    import.meta.env.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com";
  const ADMIN_KEY = import.meta.env.VITE_BCM_ADMIN_KEY || "";
  const AVATAR_ID = "c5e81098eb3e46189740b6156b3ac85a";

  // ---- DOM ----
  const videoEl   = document.getElementById("avatarVideo");
  const startBtn  = document.getElementById("startSession");
  const endBtn    = document.getElementById("endSession");
  const speakBtn  = document.getElementById("speakButton");
  const inputEl   = document.getElementById("userInput");

  // ---- STATE ----
  let avatar = null;

  // ---- HELPERS ----
  async function fetchSessionToken() {
    const res = await fetch(`${BACKEND_BASE}/heygen/token`, {
      method: "POST",
      headers: { "X-Admin-Key": ADMIN_KEY },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token fetch failed: ${res.status} ${res.statusText} | ${text}`);
    }

    const data = await res.json();
    const token = data?.session_token;
    if (!token) throw new Error("No session_token in backend response");
    return token;
  }

  function attachVideoHandlers(instance) {
    instance.on(StreamingEvents.STREAM_READY, (ev) => {
      const stream = ev.detail;
      if (stream && videoEl) {
        videoEl.srcObject = stream;
        videoEl.onloadedmetadata = () => videoEl.play().catch(console.error);
      }
    });

    instance.on(StreamingEvents.STREAM_DISCONNECTED, () => {
      if (videoEl) videoEl.srcObject = null;
      startBtn.disabled = false;
      endBtn.disabled = true;
    });
  }

  // ---- LIFECYCLE ----
  async function startSession() {
    startBtn.disabled = true;
    try {
      const token = await fetchSessionToken();
      console.log("[INFO] Got session_token:", token);

      avatar = new StreamingAvatar({ token });
      attachVideoHandlers(avatar);

      await avatar.createStartAvatar({
        quality: AvatarQuality.High,
        avatarId: AVATAR_ID,
      });

      endBtn.disabled = false;
    } catch (err) {
      console.error("Failed to start session:", err);
      startBtn.disabled = false;
      alert("Start failed. Check console for details.");
    }
  }

  async function endSession() {
    if (!avatar) return;
    try {
      await avatar.stopAvatar();
    } finally {
      if (videoEl) videoEl.srcObject = null;
      avatar = null;
      startBtn.disabled = false;
      endBtn.disabled = true;
    }
  }

  async function speak() {
    if (!avatar) return;
    const text = inputEl.value.trim();
    if (!text) return;
    try {
      await avatar.speak({ text, taskType: TaskType.TALK });
      inputEl.value = "";
    } catch (err) {
      console.error("Speak failed:", err);
    }
  }

  // ---- WIRE UP ----
  startBtn?.addEventListener("click", startSession);
  endBtn?.addEventListener("click", endSession);
  speakBtn?.addEventListener("click", speak);
})();
