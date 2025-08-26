// --- fetch shim: redirect api.heygen.com/v1/* to our backend proxy ---
const ORIG_FETCH = window.fetch;
window.fetch = async (input, init = {}) => {
  try {
    let url = typeof input === "string" ? input : input.url;

    if (url.startsWith("https://api.heygen.com/v1/")) {
      const subpath = url.slice("https://api.heygen.com/v1/".length);
      // Add admin key to reach our proxy
      init.headers = {
        ...(init.headers || {}),
        "X-Admin-Key": import.meta.env.VITE_BCM_ADMIN_KEY,
      };
      url = `${import.meta.env.VITE_BACKEND_BASE}/heygen/proxy/${subpath}`;
      input = url;
    }
  } catch (_) {}
  return ORIG_FETCH(input, init);
};

import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskType,
} from "@heygen/streaming-avatar";

// ---- CONFIG ----
const BACKEND_BASE =
  import.meta.env.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com";

// Use your assigned avatar ID
const AVATAR_ID = "c5e81098eb3e46189740b6156b3ac85a";

// ---- DOM ----
const videoEl = document.getElementById("avatarVideo");
const startBtn = document.getElementById("startSession");
const endBtn = document.getElementById("endSession");
const speakBtn = document.getElementById("speakButton");
const inputEl = document.getElementById("userInput");

// ---- STATE ----
let avatar = null;

// ---- HELPERS ----
async function fetchAccessToken() {
  const res = await fetch(`${BACKEND_BASE}/heygen/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": import.meta.env.VITE_BCM_ADMIN_KEY, // must match Render ADMIN_KEY
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Token fetch failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const token = json?.session_token;
  if (!token) {
    throw new Error("No session_token returned from backend");
  }
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
    const token = await fetchAccessToken();
    avatar = new StreamingAvatar({ token });

    attachVideoOnReady(avatar);

    const startArgs = {
      quality: AvatarQuality.High,
      avatarId: AVATAR_ID,
    };

    await avatar.createStartAvatar(startArgs);

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
startBtn.addEventListener("click", startSession);
endBtn.addEventListener("click", endSession);
speakBtn.addEventListener("click", speak);
