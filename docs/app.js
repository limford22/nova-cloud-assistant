// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.debug('SW reg failed', err));
  });
}

// State & Mesh Configurations
const MESH_BASE = "https://ntfy.sh/nova_limford22";
const CMD_URL = `${MESH_BASE}_cmd`;
const STATUS_SSE = `${MESH_BASE}_status/sse`;
const REPLY_SSE = `${MESH_BASE}_reply/sse`;

let isPCOnline = false;
let lastPCPing = 0;
let hapticsEnabled = localStorage.getItem("nova_haptics") !== "false";
let geminiKey = localStorage.getItem("nova_gemini_key") || "";

// DOM Elements
const pcStatusDot = document.getElementById("pc-status-dot");
const pcStatusText = document.getElementById("pc-status-text");
const pcSpecsBadge = document.getElementById("pc-specs-badge");
const cpuVal = document.getElementById("cpu-val");
const cpuBar = document.getElementById("cpu-bar");
const ramVal = document.getElementById("ram-val");
const ramBar = document.getElementById("ram-bar");
const ramDetails = document.getElementById("ram-details");
const batVal = document.getElementById("bat-val");
const batBar = document.getElementById("bat-bar");
const batDetails = document.getElementById("bat-details");
const diskVal = document.getElementById("disk-val");
const diskBar = document.getElementById("disk-bar");
const diskDetails = document.getElementById("disk-details");
const toastEl = document.getElementById("toast");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send");
const btnMic = document.getElementById("btn-mic");
const processListEl = document.getElementById("process-list-container");

// Haptic Feedback Helper (Samsung One UI Tactile Feel)
function triggerHaptic(duration = 18) {
  if (hapticsEnabled && navigator.vibrate) {
    try { navigator.vibrate(duration); } catch(e) {}
  }
}

// Toast Notification System
let toastTimer = null;
function showToast(message, isSuccess = true) {
  if (!toastEl) return;
  toastEl.innerHTML = (isSuccess ? "✓ " : "⚠️ ") + message;
  toastEl.className = "toast show" + (isSuccess ? "" : " toast-error");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = "toast";
  }, 2800);
}

// Tab Navigation
const navItems = document.querySelectorAll(".nav-item");
const tabPanes = document.querySelectorAll(".tab-pane");

navItems.forEach(item => {
  item.addEventListener("click", () => {
    triggerHaptic(12);
    const targetId = item.dataset.tab;
    navItems.forEach(i => i.classList.remove("active"));
    tabPanes.forEach(p => {
      p.classList.remove("active");
      p.style.display = "none";
    });

    item.classList.add("active");
    const targetPane = document.getElementById(targetId);
    if (targetPane) {
      targetPane.classList.add("active");
      targetPane.style.display = "flex";
    }
  });
});

// Telemetry Listener via Native Browser Server-Sent Events (SSE)
let statusSource = null;
let replySource = null;

function connectMesh() {
  console.log("[Mesh] Connecting to Nova Cloud Stream...");
  
  try {
    if (statusSource) statusSource.close();
    statusSource = new EventSource(STATUS_SSE);

    statusSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === "message" && payload.message) {
          const stats = JSON.parse(payload.message);
          updateTelemetry(stats);
        }
      } catch (err) {
        console.warn("[Mesh] Telemetry parse notice:", err);
      }
    };

    statusSource.onerror = () => {
      // Reconnects automatically by SSE spec
      console.debug("[Mesh] Telemetry stream reconnecting...");
    };
  } catch (e) {
    console.error("[Mesh] Status SSE error:", e);
  }

  try {
    if (replySource) replySource.close();
    replySource = new EventSource(REPLY_SSE);

    replySource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === "message" && payload.message) {
          const reply = JSON.parse(payload.message);
          handlePCReply(reply);
        }
      } catch (err) {
        console.warn("[Mesh] Reply parse notice:", err);
      }
    };
  } catch (e) {
    console.error("[Mesh] Reply SSE error:", e);
  }
}

function updateTelemetry(data) {
  lastPCPing = Date.now();
  if (!isPCOnline) {
    isPCOnline = true;
    if (pcStatusDot) pcStatusDot.classList.add("online");
    if (pcStatusText) pcStatusText.textContent = "PC: Online";
    if (pcSpecsBadge) pcSpecsBadge.style.display = "inline-flex";
    showToast("🟢 Windows PC linked & active!");
  }

  // CPU
  if (data.cpu_percent !== undefined && cpuVal && cpuBar) {
    cpuVal.textContent = `${data.cpu_percent}%`;
    cpuBar.style.width = `${Math.min(data.cpu_percent, 100)}%`;
    if (data.cpu_percent > 80) cpuBar.className = "progress-bar bar-danger";
    else if (data.cpu_percent > 50) cpuBar.className = "progress-bar bar-orange";
    else cpuBar.className = "progress-bar";
  }

  // RAM
  if (data.ram && ramVal && ramBar) {
    ramVal.textContent = `${data.ram.percent}%`;
    ramBar.style.width = `${Math.min(data.ram.percent, 100)}%`;
    if (ramDetails) ramDetails.textContent = `${data.ram.used_gb} GB / ${data.ram.total_gb} GB`;
  }

  // Battery
  if (data.battery && batVal && batBar) {
    if (data.battery.percent !== null) {
      const isPlugged = data.battery.power_plugged;
      const icon = isPlugged ? "⚡" : "🔋";
      batVal.textContent = `${icon} ${data.battery.percent}%`;
      batBar.style.width = `${Math.min(data.battery.percent, 100)}%`;
      if (batDetails) batDetails.textContent = isPlugged ? "Charging" : "On Battery";
    } else {
      batVal.textContent = "🔌 AC";
      batBar.style.width = "100%";
      if (batDetails) batDetails.textContent = "Desktop Power";
    }
  }

  // Disk C:
  if (data.disk_c && diskVal && diskBar) {
    diskVal.textContent = `${data.disk_c.percent}%`;
    diskBar.style.width = `${Math.min(data.disk_c.percent, 100)}%`;
    if (diskDetails) diskDetails.textContent = `${data.disk_c.free_gb} GB Free`;
  }

  // Top running processes list
  if (data.top_processes && processListEl) {
    renderProcesses(data.top_processes);
  }
}

function renderProcesses(procs) {
  if (!processListEl) return;
  processListEl.innerHTML = "";
  procs.forEach(p => {
    const item = document.createElement("div");
    item.className = "proc-item";
    item.innerHTML = `
      <span class="proc-name">${p.name}</span>
      <span class="proc-mem">${p.memory_percent}% RAM</span>
      <button class="btn-kill" onclick="killProcess('${p.name}')" title="End task">✕</button>
    `;
    processListEl.appendChild(item);
  });
}

function killProcess(name) {
  triggerHaptic(25);
  if (confirm(`Terminate process "${name}" on your PC?`)) {
    sendAction("kill_proc", { app_name: name });
  }
}

// Watchdog timer: turns status pill to Offline if no heartbeat for 12 seconds
setInterval(() => {
  if (isPCOnline && (Date.now() - lastPCPing > 12000)) {
    isPCOnline = false;
    if (pcStatusDot) pcStatusDot.classList.remove("online");
    if (pcStatusText) pcStatusText.textContent = "PC: Offline";
    if (pcSpecsBadge) pcSpecsBadge.style.display = "none";
    if (cpuVal) { cpuVal.textContent = "--%"; cpuBar.style.width = "0%"; }
    if (ramVal) { ramVal.textContent = "--%"; ramBar.style.width = "0%"; }
    if (batVal) { batVal.textContent = "--%"; batBar.style.width = "0%"; }
    if (diskVal) { diskVal.textContent = "--%"; diskBar.style.width = "0%"; }
  }
}, 4000);

// Initialize Cloud Mesh immediately
connectMesh();

// Action Dispatcher (POST directly to Cloud Mesh)
async function sendAction(action, params = {}) {
  triggerHaptic(20);
  
  try {
    const res = await fetch(CMD_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action: action,
        params: params,
        time: Date.now()
      })
    });
    
    if (res.ok) {
      showToast(`Command '${action}' sent ⚡`);
    } else {
      showToast(`Relay error: HTTP ${res.status}`, false);
    }
  } catch (err) {
    showToast(`Network error sending '${action}'`, false);
  }
}

function confirmAction(action, promptText) {
  triggerHaptic(25);
  if (confirm(promptText)) {
    sendAction(action);
  }
}

// Volume Slider
let volumeDebounce = null;
function adjustVolume(val) {
  triggerHaptic(10);
  const volLabel = document.getElementById("volume-level-label");
  if (volLabel) volLabel.textContent = `${val}%`;
  
  clearTimeout(volumeDebounce);
  volumeDebounce = setTimeout(() => {
    sendAction("volume_set", { level: parseInt(val) });
  }, 120);
}

// Smart Routines
function runRoutine(type) {
  triggerHaptic(30);
  if (type === "night") {
    sendAction("routine_night");
    showToast("🌙 Good Night routine triggered (Muted & Locked)");
  } else if (type === "work") {
    sendAction("routine_work");
    showToast("💼 Work mode: Launched Chrome & VS Code");
  } else if (type === "music") {
    sendAction("routine_music");
    showToast("🎵 Vibe mode: Spotify launched with sound");
  }
}

// PC Reply Handler (Screenshots, Clipboard, PowerShell output, File results)
function handlePCReply(data) {
  if (data.action === "screenshot" && data.image_base64) {
    const box = document.getElementById("screenshot-preview-container");
    const img = document.getElementById("screenshot-img");
    img.src = "data:image/jpeg;base64," + data.image_base64;
    box.style.display = "block";
    showToast("📸 Screenshot captured!");
  } else if (data.action === "get_clipboard" && data.clipboard_text !== undefined) {
    const clipInput = document.getElementById("clipboard-input");
    if (clipInput) clipInput.value = data.clipboard_text;
    showToast("📥 Clipboard text fetched!");
  } else if (data.action === "find" && data.results) {
    renderFileResults(data.results);
  } else if (data.action === "recent_files" && data.results) {
    renderFileResults(data.results);
  } else if (data.action === "powershell" && data.output !== undefined) {
    const outBox = document.getElementById("powershell-output");
    if (outBox) {
      outBox.textContent = data.output;
      outBox.style.display = "block";
    }
    showToast("✓ PowerShell executed");
  } else if (data.message) {
    showToast(data.message);
  }
}

// Tools: Fullscreen Screenshot Modal
function openScreenshotModal() {
  const img = document.getElementById("screenshot-img");
  const modal = document.getElementById("modal-lightbox");
  const modalImg = document.getElementById("modal-img");
  if (img && modal && modalImg && img.src) {
    modalImg.src = img.src;
    modal.style.display = "flex";
  }
}

function closeScreenshotModal() {
  const modal = document.getElementById("modal-lightbox");
  if (modal) modal.style.display = "none";
}

// Tools: Clipboard Sync
function sendClipboardToPC() {
  triggerHaptic(20);
  const text = document.getElementById("clipboard-input").value;
  if (!text.trim()) return showToast("Enter text first", false);
  sendAction("set_clipboard", { text: text });
  showToast("📋 Sent to Windows Clipboard!");
}

function fetchPCClipboard() {
  triggerHaptic(20);
  sendAction("get_clipboard");
}

// Tools: Screen Capture
function requestScreenshot() {
  triggerHaptic(25);
  sendAction("screenshot");
  showToast("📸 Snapping PC screenshot...");
}

// Tools: Desktop Note
function saveDesktopNote() {
  triggerHaptic(20);
  const note = document.getElementById("note-input").value;
  if (!note.trim()) return showToast("Enter note text", false);
  sendAction("note", { content: note });
  document.getElementById("note-input").value = "";
  showToast("💾 Saved to Desktop/Assistant_Notes.md");
}

// Tools: File Search
function searchPCFiles() {
  triggerHaptic(20);
  const q = document.getElementById("file-search-input").value;
  if (!q.trim()) return showToast("Enter search keyword", false);
  sendAction("find", { query: q });
  showToast(`🔍 Searching PC files for '${q}'...`);
}

function fetchRecentDesktopFiles() {
  triggerHaptic(15);
  sendAction("recent_files", { folder: "Desktop" });
}

function renderFileResults(files) {
  const container = document.getElementById("file-results-container");
  if (!container) return;
  container.innerHTML = "";
  if (!files || files.length === 0) {
    container.innerHTML = "<div class='file-item' style='color:#94a3b8;'>No files found matching query.</div>";
    return;
  }
  files.forEach(f => {
    const div = document.createElement("div");
    div.className = "file-item";
    div.innerHTML = `
      <div style="font-weight:600; color:#f8fafc;">${f.name}</div>
      <div style="font-size:0.72rem; color:#94a3b8;">${f.size} &bull; ${f.modified || ""}</div>
      <div style="font-size:0.68rem; color:#6366f1; word-break:break-all;">${f.path}</div>
    `;
    container.appendChild(div);
  });
}

// Tools: PowerShell Runner
function runCustomPS() {
  triggerHaptic(20);
  const cmd = document.getElementById("ps-input").value.trim();
  if (!cmd) return showToast("Enter command", false);
  sendAction("powershell", { command: cmd });
  showToast(`⚡ Running: ${cmd}`);
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
  triggerHaptic(18);
  appendChatMessage("user", text);

  const lower = text.toLowerCase();
  
  // Intercept desktop control commands directly from conversational chat
  if (lower.includes("lock")) { 
    sendAction("lock"); 
    appendChatMessage("assistant", "🔒 Locking your PC workstation."); 
    return; 
  }
  if (lower.includes("mute")) { 
    sendAction("volume", {action: "mute"}); 
    appendChatMessage("assistant", "🔇 Master volume muted."); 
    return; 
  }
  if (lower.includes("unmute")) { 
    sendAction("volume", {action: "unmute"}); 
    appendChatMessage("assistant", "🔊 Audio unmuted."); 
    return; 
  }
  if (lower.includes("screenshot")) { 
    requestScreenshot(); 
    appendChatMessage("assistant", "📸 Snapping PC screenshot."); 
    return; 
  }
  if (lower.includes("empty trash") || lower.includes("clean recycle")) {
    sendAction("clean");
    appendChatMessage("assistant", "🗑️ Emptying Windows Recycle Bin.");
    return;
  }
  if (lower.startsWith("open ")) { 
    const app = lower.replace("open ", "").trim();
    sendAction("app", {app_name: app}); 
    appendChatMessage("assistant", `💻 Launching "${app}" on PC.`); 
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
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response from Gemini.";
      appendChatMessage("assistant", reply);
    } catch (e) {
      appendChatMessage("assistant", `⚠️ Gemini Error: ${e.message}`);
    }
  } else {
    appendChatMessage("assistant", `Nova Cloud received: "${text}".\n\n💡 Tip: Add your free Gemini API key in Settings for smart conversational reasoning, or ask me to "lock pc", "mute", "open chrome", or "screenshot".`);
  }
}

if (btnSend) btnSend.addEventListener("click", sendChat);
if (chatInput) chatInput.addEventListener("keydown", e => { if (e.key === "Enter") sendChat(); });

// Voice Recognition (Samsung Voice & Web Speech API)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition && btnMic) {
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
    triggerHaptic(25);
    try { recognition.start(); } catch(e) {}
  });
}

// Settings Handlers
function saveGeminiKey() {
  triggerHaptic(20);
  const k = document.getElementById("gemini-key-input").value.trim();
  geminiKey = k;
  localStorage.setItem("nova_gemini_key", geminiKey);
  showToast(k ? "✓ Gemini API Key saved!" : "Key removed");
}

const hapticToggle = document.getElementById("haptic-toggle");
if (hapticToggle) {
  hapticToggle.checked = hapticsEnabled;
  hapticToggle.addEventListener("change", e => {
    hapticsEnabled = e.target.checked;
    localStorage.setItem("nova_haptics", hapticsEnabled);
  });
}

// Force Cache Reload for Updates
function forceUpdateApp() {
  triggerHaptic(30);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      for (let reg of regs) reg.unregister();
    });
  }
  showToast("Updating app cache...");
  setTimeout(() => {
    window.location.reload(true);
  }, 600);
}

// Load saved key in Settings
if (geminiKey) {
  const keyInput = document.getElementById("gemini-key-input");
  if (keyInput) keyInput.value = geminiKey;
}
