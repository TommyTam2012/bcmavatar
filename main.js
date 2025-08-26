import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskType,
} from "@heygen/streaming-avatar";

// ---- CONFIG ----
const BACKEND_BASE =
  import.meta.env.VITE_BACKEND_BASE || "https://bcm-demo.onrender.com";

// Set ONE of these (name or id). Replace with your avatar if needed.
const AVATAR_NAME = "Wayne_20240711"; // change to yours
const AVATAR_ID = "c5e81098eb3e46189740b6156b3ac85a"; // or null if using name

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
      "X-Admin-Key": import.meta.env.VITE_BCM_ADMIN_KEY, // 🔑 added
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Token fetch failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  // support several shapes
  return json?.data?.token || json?.session_token || json?.token;
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
      ...(AVATAR_ID ? { avatarId: AVATAR_ID } : { avatarName: AVATAR_NAME }),
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
