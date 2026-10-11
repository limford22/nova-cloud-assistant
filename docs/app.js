// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.debug('SW reg failed', err));
  });
}

// State & Configurations
const MQTT_BROKER = "wss://broker.hivemq.com:8884/mqtt";
const USER_CHANNEL = "nova/limford22";
const TOPIC_CMD = `${USER_CHANNEL}/cmd`;
const TOPIC_STATUS = `${USER_CHANNEL}/status`;
const TOPIC_REPLY = `${USER_CHANNEL}/reply`;

let mqttClient = null;
let isPCOnline = false;
let lastPCPing = 0;
let hapticsEnabled = localStorage.getItem("nova_haptics") !== "false";
let geminiKey = localStorage.getItem("nova_gemini_key") || "";

// DOM Elements
const pcStatusDot = document.getElementById("pc-status-dot");
const pcStatusText = document.getElementById("pc-status-text");
const cpuVal = document.getElementById("cpu-val");
const cpuBar = document.getElementById("cpu-bar");
const ramVal = document.getElementById("ram-val");
const ramBar = document.getElementById("ram-bar");
const batVal = document.getElementById("bat-val");
const batBar = document.getElementById("bat-bar");
const diskVal = document.getElementById("disk-val");
const diskBar = document.getElementById("disk-bar");
const toastEl = document.getElementById("toast");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send");
const btnMic = document.getElementById("btn-mic");

// Haptic Feedback Helper
function triggerHaptic() {
  if (hapticsEnabled && navigator.vibrate) {
    try { navigator.vibrate(18); } catch(e) {}
  }
}

// Toast System
let toastTimer = null;
function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 2500);
}

// Tab Navigation
const navItems = document.querySelectorAll(".nav-item");
const tabPanes = document.querySelectorAll(".tab-pane");

navItems.forEach(item => {
  item.addEventListener("click", () => {
    triggerHaptic();
    const targetId = item.dataset.tab;
    navItems.forEach(i => i.classList.remove("active"));
    tabPanes.forEach(p => p.classList.remove("active"));

    item.classList.add("active");
    const targetPane = document.getElementById(targetId);
    if (targetPane) targetPane.classList.add("active");
  });
});

// MQTT Real-time Cloud Mesh
function initMQTT() {
  const clientId = "nova_pwa_" + Math.random().toString(16).substring(2, 10);
  mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: clientId,
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 3000
  });

  mqttClient.on("connect", () => {
    console.log("[Mesh] Connected to Cloud Broker");
    mqttClient.subscribe(TOPIC_STATUS);
    mqttClient.subscribe(TOPIC_REPLY);
  });

  mqttClient.on("message", (topic, msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (topic === TOPIC_STATUS) {
        updateTelemetry(data);
      } else if (topic === TOPIC_REPLY) {
        handlePCReply(data);
      }
    } catch (e) {
      console.warn("MQTT Parse error", e);
    }
  });
}

function updateTelemetry(data) {
  lastPCPing = Date.now();
  if (!isPCOnline) {
    isPCOnline = true;
    pcStatusDot.classList.add("online");
    pcStatusText.textContent = "PC: Online";
  }

  // CPU
  if (data.cpu_percent !== undefined) {
    cpuVal.textContent = `${data.cpu_percent}%`;
    cpuBar.style.width = `${Math.min(data.cpu_percent, 100)}%`;
  }

  // RAM
  if (data.ram) {
    ramVal.textContent = `${data.ram.percent}%`;
    ramBar.style.width = `${Math.min(data.ram.percent, 100)}%`;
  }

  // Battery
  if (data.battery && data.battery.percent !== null) {
    const icon = data.battery.power_plugged ? "⚡" : "🔋";
    batVal.textContent = `${icon} ${data.battery.percent}%`;
    batBar.style.width = `${Math.min(data.battery.percent, 100)}%`;
  }

  // Disk
  if (data.disk_c) {
    diskVal.textContent = `${data.disk_c.percent}%`;
    diskBar.style.width = `${Math.min(data.disk_c.percent, 100)}%`;
  }
}

// Watchdog for PC Online status
setInterval(() => {
  if (isPCOnline && (Date.now() - lastPCPing > 12000)) {
    isPCOnline = false;
    pcStatusDot.classList.remove("online");
    pcStatusText.textContent = "PC: Offline";
    cpuVal.textContent = "--%"; cpuBar.style.width = "0%";
    ramVal.textContent = "--%"; ramBar.style.width = "0%";
    batVal.textContent = "--%"; batBar.style.width = "0%";
    diskVal.textContent = "--%"; diskBar.style.width = "0%";
  }
}, 4000);

initMQTT();

// Action Dispatcher
function sendAction(action, params = {}) {
  triggerHaptic();
  if (!mqttClient || !mqttClient.connected) {
    showToast("⚠️ Connecting to cloud mesh...");
    return;
  }

  mqttClient.publish(TOPIC_CMD, JSON.stringify({
    action: action,
    params: params,
    time: Date.now()
  }));

  showToast(`⚡ Command '${action}' sent`);
}

function confirmAction(action, promptText) {
  triggerHaptic();
  if (confirm(promptText)) {
    sendAction(action);
  }
}

// Volume Slider
function adjustVolume(val) {
  triggerHaptic();
  sendAction("volume_set", { level: parseInt(val) });
}

// Smart Routines
function runRoutine(type) {
  triggerHaptic();
  if (type === "night") {
    sendAction("routine_night");
    showToast("🌙 Good Night routine triggered");
  } else if (type === "work") {
    sendAction("routine_work");
    showToast("💼 Work mode triggered");
  } else if (type === "music") {
    sendAction("routine_music");
    showToast("🎵 Vibe mode triggered");
  }
}

// PC Reply Handler (Replies, Screenshots, Clipboard)
function handlePCReply(data) {
  if (data.action === "screenshot" && data.image_base64) {
    const box = document.getElementById("screenshot-preview-container");
    const img = document.getElementById("screenshot-img");
    img.src = "data:image/jpeg;base64," + data.image_base64;
    box.style.display = "block";
    showToast("📸 Screenshot captured!");
  } else if (data.action === "get_clipboard" && data.clipboard_text !== undefined) {
    document.getElementById("clipboard-input").value = data.clipboard_text;
    showToast("📥 Clipboard text fetched!");
  } else if (data.action === "find" && data.results) {
    renderFileResults(data.results);
  } else if (data.message) {
    showToast(`✓ ${data.message}`);
  }
}

// Tools: Clipboard Sync
function sendClipboardToPC() {
  triggerHaptic();
  const text = document.getElementById("clipboard-input").value;
  if (!text.trim()) return showToast("Enter text first");
  sendAction("set_clipboard", { text: text });
  showToast("📋 Sent to Windows Clipboard!");
}

function fetchPCClipboard() {
  triggerHaptic();
  sendAction("get_clipboard");
}

// Tools: Screen Capture
function requestScreenshot() {
  triggerHaptic();
  sendAction("screenshot");
  showToast("📸 Snapping PC screenshot...");
}

// Tools: Desktop Note
function saveDesktopNote() {
  triggerHaptic();
  const note = document.getElementById("note-input").value;
  if (!note.trim()) return showToast("Enter note text");
  sendAction("note", { content: note });
  document.getElementById("note-input").value = "";
  showToast("💾 Saved to Desktop Notes!");
}

// Tools: File Search
function searchPCFiles() {
  triggerHaptic();
  const q = document.getElementById("file-search-input").value;
  if (!q.trim()) return showToast("Enter search keyword");
  sendAction("find", { query: q });
  showToast(`🔍 Searching for '${q}'...`);
}

function renderFileResults(files) {
  const container = document.getElementById("file-results-container");
  container.innerHTML = "";
  if (!files || files.length === 0) {
    container.innerHTML = "<div class='file-item'>No files found matching query.</div>";
    return;
  }
  files.forEach(f => {
    const div = document.createElement("div");
    div.className = "file-item";
    div.innerHTML = `<strong>${f.name}</strong> (${f.size})<br><span style="color:#64748b;">${f.path}</span>`;
    container.appendChild(div);
  });
}

// AI Chat View (Speech & Gemini)
function appendChatMessage(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  bubble.innerHTML = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  triggerHaptic();
  appendChatMessage("user", text);

  const lower = text.toLowerCase();
  
  // Intercept desktop commands directly from chat
  if (lower.includes("lock")) { sendAction("lock"); appendChatMessage("assistant", "🔒 Locking your PC."); return; }
  if (lower.includes("mute")) { sendAction("volume", {action: "mute"}); appendChatMessage("assistant", "🔇 Volume muted."); return; }
  if (lower.includes("screenshot")) { requestScreenshot(); appendChatMessage("assistant", "📸 Capturing screen."); return; }
  if (lower.startsWith("open ")) { 
    const app = lower.replace("open ", "");
    sendAction("app", {app_name: app}); 
    appendChatMessage("assistant", `💻 Launching ${app} on PC.`); 
    return; 
  }

  // Cloud Gemini AI Reasoning
  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: text }] }]
        })
      });
      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response received.";
      appendChatMessage("assistant", reply);
    } catch (e) {
      appendChatMessage("assistant", `⚠️ Gemini Error: ${e.message}`);
    }
  } else {
    appendChatMessage("assistant", `Nova Cloud received: "${text}". (Add your Gemini API key in Settings for full conversational reasoning).`);
  }
}

btnSend.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });

// Voice Recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = "en-US";

  recognition.onstart = () => btnMic.classList.add("listening");
  recognition.onend = () => btnMic.classList.remove("listening");
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    chatInput.value = transcript;
    sendChat();
  };

  btnMic.addEventListener("click", () => {
    triggerHaptic();
    try { recognition.start(); } catch(e) {}
  });
}

// Settings Handlers
function saveGeminiKey() {
  triggerHaptic();
  const k = document.getElementById("gemini-key-input").value.trim();
  if (k) {
    geminiKey = k;
    localStorage.setItem("nova_gemini_key", geminiKey);
    showToast("✓ Gemini API Key saved!");
  }
}

const hapticToggle = document.getElementById("haptic-toggle");
if (hapticToggle) {
  hapticToggle.checked = hapticsEnabled;
  hapticToggle.addEventListener("change", e => {
    hapticsEnabled = e.target.checked;
    localStorage.setItem("nova_haptics", hapticsEnabled);
  });
}

// Load saved key in Settings
if (geminiKey) {
  const keyInput = document.getElementById("gemini-key-input");
  if (keyInput) keyInput.value = geminiKey;
}
