// 1) Install fetch shim FIRST, before we load the SDK
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

      console.log("[DEBUG] Proxying HeyGen API →", url);
      console.log("[DEBUG] X-Admin-Key header (shim) =", import.meta.env.VITE_BCM_ADMIN_KEY);

      url = `${import.meta.env.VITE_BACKEND_BASE}/heygen/proxy/${subpath}`;
      input = url;
    }
  } catch (err) {
    console.warn("[DEBUG] fetch shim error:", err);
  }
  return ORIG_FETCH(input, init);
};

// 2) Wrap everything else so we can dynamically import the SDK AFTER the shim is installed
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

  // Use your assigned avatar ID
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
  async function fetchAccessToken() {
    console.log("[DEBUG] Hitting backend for token →", `${BACKEND_BASE}/heygen/token`);
    console.log("[DEBUG] X-Admin-Key header (fetchAccessToken) =", import.meta.env.VITE_BCM_ADMIN_KEY);

    const res = await fetch(`${BACKEND_BASE}/heygen/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": import.meta.env.VITE_BCM_ADMIN_KEY, // must match backend ADMIN_KEY
      },
      cache: "no-store",
    });

    console.log("[DEBUG] Token fetch response status:", res.status, res.statusText);
    const raw = await res.text();
    console.log("[DEBUG] Raw backend response:", raw);

    if (!res.ok) {
      throw new Error(`Token fetch failed: ${res.status} ${res.statusText} | ${raw}`);
    }

    let json;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new Error("Failed to parse backend JSON: " + raw);
    }

    const token = json?.session_token;
    if (!token) throw new Error("No session_token returned from backend");
    return token;
  }

  function attachVideoOnReady(instance) {
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
      const token = await fetchAccessToken();        // hits /heygen/token
      console.log("[DEBUG] Received session_token =", token);

      avatar = new StreamingAvatar({ token });       // SDK loads AFTER shim
      attachVideoOnReady(avatar);

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
      await avatar.speak({ text, taskType: TaskType.REPEAT }); // or TaskType.TALK
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
