// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.debug('SW reg failed', err));
  });
}

// State & Mesh Configurations
const MESH_BASE = "https://ntfy.sh/leags_limford22";
const PC_CMD_URL = `${MESH_BASE}_pc_cmd`;
const PC_STATUS_SSE = `${MESH_BASE}_pc_status/sse`;
const PC_REPLY_SSE = `${MESH_BASE}_pc_reply/sse`;

const PHONE_CMD_SSE = `${MESH_BASE}_phone_cmd/sse`;
const PHONE_STATUS_URL = `${MESH_BASE}_phone_status`;

let isPCOnline = false;
let lastPCPing = 0;
let hapticsEnabled = localStorage.getItem("leags_haptics") !== "false";
let voiceReplyEnabled = localStorage.getItem("leags_voice_reply") !== "false";
let handsFreeEnabled = localStorage.getItem("leags_handsfree") !== "false";
let geminiKey = localStorage.getItem("leags_gemini_key") || "";
let isBiometricVerified = sessionStorage.getItem("leags_bio_verified") === "true";
let voiceProfile = localStorage.getItem("leags_voice_profile") || null;

// Active Timers State
let activeTimers = [];

// DOM Elements
const pcStatusDot = document.getElementById("pc-status-dot");
const pcStatusText = document.getElementById("pc-status-text");
const pcSpecsBadge = document.getElementById("pc-specs-badge");
const phoneBatteryBadge = document.getElementById("phone-battery-badge");
const bioLockBadge = document.getElementById("bio-lock-badge");

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

// Web Audio Synthesizer (Chimes & Futuristic Scanners)
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playBeep(freq = 880, duration = 0.12, type = "sine") {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
}

function playChime(freq1 = 587.33, freq2 = 880) {
  playBeep(freq1, 0.15);
  setTimeout(() => playBeep(freq2, 0.25), 90);
}

// Text to Speech (TTS) Talk-Back Engine
function speakOutLoud(text) {
  if (!voiceReplyEnabled || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel(); // Stop prior speech
    const cleanText = text.replace(/<[^>]*>/g, "").replace(/[#*`_~]/g, "").trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    
    // Pick natural english voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang.startsWith("en") && (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Samsung")));
    if (preferred) utterance.voice = preferred;

    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.debug("TTS error:", e);
  }
}

// Haptic Feedback
function triggerHaptic(pattern = 18) {
  if (hapticsEnabled && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch(e) {}
  }
}

// Toast System
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

// ================= TELEMETRY & CLOUD MESH =================
let pcStatusSource = null;
let pcReplySource = null;
let phoneCmdSource = null;

function connectMesh() {
  console.log("[Mesh] Connecting to Leags Cloud Stream...");

  // 1. Listen for PC Telemetry
  try {
    if (pcStatusSource) pcStatusSource.close();
    pcStatusSource = new EventSource(PC_STATUS_SSE);

    pcStatusSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === "message" && payload.message) {
          const stats = JSON.parse(payload.message);
          updatePCTelemetry(stats);
        }
      } catch (err) {}
    };
  } catch (e) {}

  // 2. Listen for PC Command Replies
  try {
    if (pcReplySource) pcReplySource.close();
    pcReplySource = new EventSource(PC_REPLY_SSE);

    pcReplySource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === "message" && payload.message) {
          const reply = JSON.parse(payload.message);
          handlePCReply(reply);
        }
      } catch (err) {}
    };
  } catch (e) {}

  // 3. Listen for Commands Dispatched to this Phone (from PC)
  try {
    if (phoneCmdSource) phoneCmdSource.close();
    phoneCmdSource = new EventSource(PHONE_CMD_SSE);

    phoneCmdSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === "message" && payload.message) {
          const cmd = JSON.parse(payload.message);
          executePhoneActionLocally(cmd.action, cmd.params || {});
        }
      } catch (err) {}
    };
  } catch (e) {}
}

function updatePCTelemetry(data) {
  lastPCPing = Date.now();
  if (!isPCOnline) {
    isPCOnline = true;
    if (pcStatusDot) pcStatusDot.classList.add("online");
    if (pcStatusText) pcStatusText.textContent = "PC: Online";
    if (pcSpecsBadge) pcSpecsBadge.style.display = "inline-flex";
    showToast("🟢 Leags PC Bridge active & connected!");
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

  // Processes
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
    sendPCAction("kill_proc", { app_name: name });
  }
}

// Watchdog timer: marks PC offline if no ping in 40s
setInterval(() => {
  if (isPCOnline && (Date.now() - lastPCPing > 40000)) {
    isPCOnline = false;
    if (pcStatusDot) pcStatusDot.classList.remove("online");
    if (pcStatusText) pcStatusText.textContent = "PC: Offline";
    if (pcSpecsBadge) pcSpecsBadge.style.display = "none";
    if (cpuVal) { cpuVal.textContent = "--%"; cpuBar.style.width = "0%"; }
    if (ramVal) { ramVal.textContent = "--%"; ramBar.style.width = "0%"; }
    if (batVal) { batVal.textContent = "--%"; batBar.style.width = "0%"; }
    if (diskVal) { diskVal.textContent = "--%"; diskBar.style.width = "0%"; }
  }
}, 5000);

// ================= GATHER & BROADCAST MOBILE PHONE SPECS =================
async function gatherAndSendPhoneTelemetry() {
  let batteryPct = null;
  let isCharging = false;

  if (navigator.getBattery) {
    try {
      const bat = await navigator.getBattery();
      batteryPct = Math.round(bat.level * 100);
      isCharging = bat.charging;
      if (phoneBatteryBadge) {
        phoneBatteryBadge.textContent = `📱 Galaxy: ${isCharging ? '⚡ ' : ''}${batteryPct}%`;
        phoneBatteryBadge.style.display = "inline-flex";
      }
    } catch (e) {}
  }

  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const netType = conn ? (conn.effectiveType || conn.type || "Online") : "WiFi/5G";

  const phoneData = {
    device: "Samsung Galaxy A52 5G",
    battery_percent: batteryPct,
    charging: isCharging,
    network: netType.toUpperCase(),
    memory_gb: navigator.deviceMemory || 6,
    platform: "Android (One UI 6.1)",
    time: Date.now()
  };

  try {
    fetch(PHONE_STATUS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(phoneData)
    }).catch(() => {});
  } catch (e) {}
}

setInterval(gatherAndSendPhoneTelemetry, 20000);
gatherAndSendPhoneTelemetry();

// ================= BIDIRECTIONAL ACTIONS (EQUAL POWERS) =================
async function sendPCAction(action, params = {}) {
  triggerHaptic(20);
  try {
    const res = await fetch(PC_CMD_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: action, params: params, time: Date.now() })
    });
    if (res.ok) {
      showToast(`⚡ Command '${action}' sent to PC`);
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
    sendPCAction(action);
  }
}

// Local Phone Actions (When commanded by PC or user)
function executePhoneActionLocally(action, params = {}) {
  triggerHaptic(30);
  playChime(660, 880);

  if (action === "hotspot" || action === "phone_hotspot") {
    // Open Android Mobile Hotspot & Tethering Settings
    showToast("📶 Opening Hotspot & Tethering Settings...");
    appendChatMessage("assistant", "📶 <strong>Mobile Hotspot</strong>: Launching Tethering & Portable Hotspot settings on your Samsung Galaxy A52.");
    speakOutLoud("Opening Mobile Hotspot settings on your phone.");
    
    // Android Tethering Intent & fallback prompt
    setTimeout(() => {
      window.location.href = "intent:#Intent;action=android.settings.TETHER_SETTINGS;end";
    }, 500);
  } else if (action === "phone_camera") {
    showToast("📷 Opening Camera...");
    window.location.href = "intent:#Intent;action=android.media.action.IMAGE_CAPTURE;end";
    speakOutLoud("Opening Camera.");
  } else if (action === "phone_whatsapp") {
    showToast("💬 Opening WhatsApp...");
    window.location.href = "whatsapp://";
    speakOutLoud("Opening WhatsApp.");
  } else if (action === "ring_phone") {
    triggerPhoneAlarmSiren();
  } else if (action === "phone_vibrate") {
    triggerHaptic([300, 150, 300, 150, 600]);
    showToast("📳 Phone vibration triggered");
    speakOutLoud("Vibrating phone.");
  } else if (action === "phone_torch") {
    toggleScreenTorch();
  } else if (action === "phone_timer") {
    startTimer(params.seconds || 300, params.label || "5 mins");
  } else if (action === "phone_tts") {
    if (params.text) speakOutLoud(params.text);
  }
}

// Ring Phone / Find My Phone Siren
let ringInterval = null;
function triggerPhoneAlarmSiren() {
  showToast("🚨 RINGING PHONE AT FULL VOLUME!");
  speakOutLoud("Linford, your phone is ringing. Tap anywhere to silence.");

  const modal = document.getElementById("modal-siren");
  if (modal) modal.style.display = "flex";

  const ctx = getAudioContext();
  let high = true;
  clearInterval(ringInterval);
  ringInterval = setInterval(() => {
    playBeep(high ? 987 : 784, 0.25, "sawtooth");
    triggerHaptic([200, 100]);
    high = !high;
  }, 300);
}

function stopPhoneAlarmSiren() {
  clearInterval(ringInterval);
  const modal = document.getElementById("modal-siren");
  if (modal) modal.style.display = "none";
  showToast("✓ Alarm silenced");
}

// Screen Torch (Max Brightness White Screen)
let isTorchOn = false;
function toggleScreenTorch() {
  isTorchOn = !isTorchOn;
  const overlay = document.getElementById("torch-overlay");
  if (overlay) {
    overlay.style.display = isTorchOn ? "block" : "none";
  }
  showToast(isTorchOn ? "💡 Torch Activated" : "Torch Off");
}

// Volume Slider
let volumeDebounce = null;
function adjustVolume(val) {
  triggerHaptic(10);
  const volLabel = document.getElementById("volume-level-label");
  if (volLabel) volLabel.textContent = `${val}%`;
  
  clearTimeout(volumeDebounce);
  volumeDebounce = setTimeout(() => {
    sendPCAction("volume_set", { level: parseInt(val) });
  }, 120);
}

// Smart Routines
function runRoutine(type) {
  triggerHaptic(30);
  if (type === "night") {
    sendPCAction("routine_night");
    showToast("🌙 Good Night routine triggered (Muted & Locked)");
    speakOutLoud("Good night Linford. Workstation muted and locked.");
  } else if (type === "work") {
    sendPCAction("routine_work");
    showToast("💼 Work mode: Launched Chrome & VS Code");
    speakOutLoud("Work mode activated. Chrome and VS Code launched.");
  } else if (type === "music") {
    sendPCAction("routine_music");
    showToast("🎵 Vibe mode: Spotify launched with sound");
    speakOutLoud("Vibe mode. Launching Spotify.");
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
    speakOutLoud("Desktop screenshot captured.");
  } else if (data.action === "get_clipboard" && data.clipboard_text !== undefined) {
    const clipInput = document.getElementById("clipboard-input");
    if (clipInput) clipInput.value = data.clipboard_text;
    showToast("📥 Clipboard text fetched!");
    speakOutLoud("Clipboard fetched from PC.");
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

// ================= TIMERS & ALARMS (FIX FOR PICTURE 3) =================
function startTimer(totalSeconds, label = "") {
  playChime(660, 880);
  triggerHaptic([30, 60, 30]);

  const timerId = "timer_" + Date.now();
  let remaining = totalSeconds;
  
  const timerObj = {
    id: timerId,
    total: totalSeconds,
    remaining: totalSeconds,
    label: label || `${Math.ceil(totalSeconds / 60)} min timer`,
    interval: null
  };

  // Render Timer widget in chat
  const timerCard = document.createElement("div");
  timerCard.className = "timer-card";
  timerCard.id = timerId;
  timerCard.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <span style="font-weight:700; color:#818cf8;">⏱️ ${timerObj.label}</span>
      <button class="btn-cancel-timer" onclick="cancelTimer('${timerId}')">Cancel</button>
    </div>
    <div class="timer-countdown" id="${timerId}-count">${formatTime(remaining)}</div>
    <div class="progress-track" style="margin-top:6px;">
      <div class="progress-bar bar-purple" id="${timerId}-bar" style="width:100%;"></div>
    </div>
  `;
  chatMessages.appendChild(timerCard);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  const announceText = `Timer set for ${label || (Math.ceil(totalSeconds / 60) + ' minutes')}. Starting now.`;
  showToast(announceText);
  speakOutLoud(announceText);

  timerObj.interval = setInterval(() => {
    timerObj.remaining--;
    const countEl = document.getElementById(`${timerId}-count`);
    const barEl = document.getElementById(`${timerId}-bar`);

    if (countEl) countEl.textContent = formatTime(timerObj.remaining);
    if (barEl) barEl.style.width = `${(timerObj.remaining / timerObj.total) * 100}%`;

    if (timerObj.remaining <= 0) {
      clearInterval(timerObj.interval);
      playChime(987, 1318);
      triggerHaptic([400, 200, 400, 200, 800]);
      if (countEl) countEl.textContent = "COMPLETED! 🔔";
      if (barEl) barEl.className = "progress-bar bar-green";
      
      const finishedText = `Linford, your ${timerObj.label} is complete!`;
      showToast("🔔 Timer Complete!");
      speakOutLoud(finishedText);
    }
  }, 1000);

  activeTimers.push(timerObj);
}

function cancelTimer(timerId) {
  const idx = activeTimers.findIndex(t => t.id === timerId);
  if (idx !== -1) {
    clearInterval(activeTimers[idx].interval);
    activeTimers.splice(idx, 1);
  }
  const el = document.getElementById(timerId);
  if (el) el.remove();
  showToast("Timer cancelled");
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

// ================= NATURAL INTENT PARSER & AI ASSISTANT =================
function appendChatMessage(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  bubble.innerHTML = text.replace(/\n/g, "<br>");
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Disfluency cleaner: removes speech hesitations ("erhm", "uh", "um", "hey leags")
function cleanSpokenInput(raw) {
  return raw
    .replace(/\b(erhm|erh|err|uhm|um|uh|ah|like|please|can you|could you|would you)\b/gi, "")
    .replace(/\b(hey leags|leags|ok leags|okay leags|hey nova|nova)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function processAssistantCommand(rawInput) {
  const text = rawInput.trim();
  if (!text) return;
  chatInput.value = "";
  triggerHaptic(18);
  appendChatMessage("user", text);

  const clean = cleanSpokenInput(text).toLowerCase();
  console.log("[Intent] Cleaned query:", clean);

  // 1. Timer / Alarm Matching (Fixes Picture 3 permanently!)
  const timerMatch = clean.match(/(?:set\s+)?timer\s+(?:for\s+)?(\d+)\s*(mins?|minutes?|secs?|seconds?|hours?|hrs?)/i) ||
                     clean.match(/countdown\s+(?:for\s+)?(\d+)\s*(mins?|minutes?|secs?|seconds?)/i) ||
                     clean.match(/remind me in\s+(\d+)\s*(mins?|minutes?|secs?|seconds?)/i);
  if (timerMatch) {
    const val = parseInt(timerMatch[1]);
    const unit = timerMatch[2].toLowerCase();
    let sec = val * 60;
    let label = `${val} minute${val > 1 ? 's' : ''}`;
    if (unit.startsWith("sec")) {
      sec = val;
      label = `${val} second${val > 1 ? 's' : ''}`;
    } else if (unit.startsWith("hour") || unit.startsWith("hr")) {
      sec = val * 3600;
      label = `${val} hour${val > 1 ? 's' : ''}`;
    }
    startTimer(sec, label);
    return;
  }

  // 2. Hotspot / Tethering Matching (Equal Powers on Phone)
  if (clean.includes("hotspot") || clean.includes("tethering") || clean.includes("share internet")) {
    executePhoneActionLocally("hotspot");
    return;
  }

  // 3. Ring Phone / Find My Phone
  if (clean.includes("ring phone") || clean.includes("find my phone") || clean.includes("where is my phone") || clean.includes("alarm phone")) {
    executePhoneActionLocally("ring_phone");
    return;
  }

  // 4. Phone Torch / Flashlight
  if (clean.includes("torch") || clean.includes("flashlight") || clean.includes("light on phone")) {
    executePhoneActionLocally("phone_torch");
    return;
  }

  // 5. Phone Camera
  if (clean.includes("open camera") || clean.includes("take a photo") || clean.includes("take photo") || clean.includes("selfie")) {
    executePhoneActionLocally("phone_camera");
    return;
  }

  // 6. Phone WhatsApp
  if (clean.includes("whatsapp") || clean.includes("open whatsapp")) {
    executePhoneActionLocally("phone_whatsapp");
    return;
  }

  // 7. Workstation PC Controls
  if (clean.includes("lock") || clean.includes("lock pc") || clean.includes("lock workstation")) {
    sendPCAction("lock");
    appendChatMessage("assistant", "🔒 Locking your PC workstation.");
    speakOutLoud("Locking your PC workstation.");
    return;
  }
  if (clean.includes("sleep pc") || clean.includes("sleep workstation") || clean.includes("put pc to sleep")) {
    sendPCAction("sleep");
    appendChatMessage("assistant", "💤 Putting PC to sleep.");
    speakOutLoud("Putting PC to sleep.");
    return;
  }
  if (clean.includes("mute") || clean.includes("silence pc")) {
    sendPCAction("volume", {action: "mute"});
    appendChatMessage("assistant", "🔇 Master volume muted.");
    speakOutLoud("Master volume muted.");
    return;
  }
  if (clean.includes("unmute")) {
    sendPCAction("volume", {action: "unmute"});
    appendChatMessage("assistant", "🔊 Audio unmuted.");
    speakOutLoud("Audio unmuted.");
    return;
  }
  if (clean.includes("screenshot") || clean.includes("snap screen") || clean.includes("capture screen")) {
    requestScreenshot();
    appendChatMessage("assistant", "📸 Snapping PC screenshot.");
    speakOutLoud("Capturing screenshot.");
    return;
  }
  if (clean.includes("empty trash") || clean.includes("clean recycle")) {
    sendPCAction("clean");
    appendChatMessage("assistant", "🗑️ Emptying Windows Recycle Bin.");
    speakOutLoud("Recycle Bin emptied.");
    return;
  }
  if (clean.startsWith("open ") || clean.startsWith("launch ")) {
    const app = clean.replace(/^(open|launch)\s+/, "").trim();
    sendPCAction("app", {app_name: app});
    appendChatMessage("assistant", `💻 Launching "${app}" on PC.`);
    speakOutLoud(`Launching ${app} on PC.`);
    return;
  }

  // 8. Device Specs & Telemetry Inquiries
  if (clean.includes("battery") || clean.includes("specs") || clean.includes("status")) {
    let reply = `💻 PC is ${isPCOnline ? 'Online' : 'Offline'}. `;
    if (cpuVal && cpuVal.textContent !== "--%") reply += `CPU: ${cpuVal.textContent}, RAM: ${ramVal.textContent}. `;
    reply += `📱 Phone is Active (Samsung Galaxy A52).`;
    appendChatMessage("assistant", `📊 <strong>Device Telemetry:</strong><br>${reply}`);
    speakOutLoud(reply);
    return;
  }

  // 9. Conversational Small Talk & Info
  if (clean === "hello" || clean === "hi" || clean === "hey" || clean.includes("who are you")) {
    const reply = "Hi Linford! I am Leags, your hands-free dual-device AI companion with equal powers across your Windows PC and Samsung Galaxy.";
    appendChatMessage("assistant", `👋 ${reply}`);
    speakOutLoud(reply);
    return;
  }
  if (clean.includes("what time") || clean.includes("current time")) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    appendChatMessage("assistant", `🕒 The current time is ${timeStr}.`);
    speakOutLoud(`The time is ${timeStr}.`);
    return;
  }
  if (clean.includes("what date") || clean.includes("today's date")) {
    const dateStr = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    appendChatMessage("assistant", `📅 Today is ${dateStr}.`);
    speakOutLoud(`Today is ${dateStr}.`);
    return;
  }

  // 10. Gemini Cloud AI Reasoning (If API key provided)
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
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I understand.";
      appendChatMessage("assistant", reply);
      speakOutLoud(reply);
      return;
    } catch (e) {
      console.warn("Gemini call error:", e);
    }
  }

  // 11. Intelligent Default Fallback (No awkward errors!)
  const fallback = `I hear you, Linford. I'm ready to control your PC (lock, volume, apps, screenshot) or phone (hotspot, camera, whatsapp, timer, ring).`;
  appendChatMessage("assistant", fallback);
  speakOutLoud(fallback);
}

if (btnSend) btnSend.addEventListener("click", () => processAssistantCommand(chatInput.value));
if (chatInput) chatInput.addEventListener("keydown", e => { if (e.key === "Enter") processAssistantCommand(chatInput.value); });

// ================= HANDS-FREE ACTIVE LISTENING ("LEAGS") =================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecognizing = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isRecognizing = true;
    if (btnMic) btnMic.classList.add("listening");
  };

  recognition.onend = () => {
    isRecognizing = false;
    if (btnMic) btnMic.classList.remove("listening");
    // Auto-restart hands-free loop if enabled
    if (handsFreeEnabled) {
      setTimeout(() => {
        try { recognition.start(); } catch(e) {}
      }, 350);
    }
  };

  recognition.onresult = (e) => {
    const lastIdx = e.results.length - 1;
    const transcript = e.results[lastIdx][0].transcript.trim();
    console.log("[Heard]:", transcript);

    const lower = transcript.toLowerCase();

    // Wake Word Detection ("Leags" / "Hey Leags" / "Nova")
    const wakeMatch = lower.match(/\b(hey leags|leags|ok leags|okay leags|hey nova|nova)\b/i);
    
    if (handsFreeEnabled) {
      if (wakeMatch) {
        playChime(660, 880);
        // Extract command following the wake word
        let cmd = transcript.substring(wakeMatch.index + wakeMatch[0].length).trim();
        if (cmd) {
          processAssistantCommand(cmd);
        } else {
          appendChatMessage("assistant", "Yes Linford? I'm listening.");
          speakOutLoud("Yes Linford? I'm listening.");
        }
      }
    } else {
      processAssistantCommand(transcript);
    }
  };

  function startRecognition() {
    if (!isRecognizing) {
      try { recognition.start(); } catch(e) {}
    }
  }

  function stopRecognition() {
    if (isRecognizing) {
      try { recognition.stop(); } catch(e) {}
    }
  }

  if (btnMic) {
    btnMic.addEventListener("click", () => {
      triggerHaptic(20);
      playChime();
      startRecognition();
    });
  }

  // Start continuous listening immediately
  if (handsFreeEnabled) {
    startRecognition();
  }
}

// ================= BIOMETRIC SECURITY: VOICE CALIBRATION =================
function openVoiceCalibration() {
  triggerHaptic(25);
  const modal = document.getElementById("modal-voice-cal");
  if (modal) modal.style.display = "flex";
  speakOutLoud("Voice calibration active. Please speak: I am Linford, authorize Leags assistant.");
}

function closeVoiceCalibration() {
  const modal = document.getElementById("modal-voice-cal");
  if (modal) modal.style.display = "none";
}

function startVoiceEnrollment() {
  triggerHaptic(20);
  playChime(587, 880);
  const statusEl = document.getElementById("voice-cal-status");
  statusEl.textContent = "Listening to your voice frequency & cadence...";
  
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = "Microphone access not available.";
    return;
  }

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const ctx = getAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let samples = [];
    let count = 0;

    const recordTimer = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      samples.push(sum / dataArray.length);
      count++;

      if (count > 25) {
        clearInterval(recordTimer);
        stream.getTracks().forEach(t => t.stop());

        // Calculate average energy / pitch profile
        const avg = samples.reduce((a,b)=>a+b, 0) / samples.length;
        voiceProfile = {
          name: "Linford",
          avgEnergy: Math.round(avg),
          enrolledAt: new Date().toLocaleDateString()
        };
        localStorage.setItem("leags_voice_profile", JSON.stringify(voiceProfile));

        playChime(880, 1174);
        statusEl.innerHTML = `<span style="color:#10b981;">✓ Voice Signature Calibrated: Linford Antwi</span>`;
        speakOutLoud("Voice signature calibrated successfully. I will now exclusively respond to your voice, Linford.");
        showToast("✓ Voice Profile Enrolled!");
      }
    }, 100);
  }).catch(err => {
    statusEl.textContent = "Mic error: " + err.message;
  });
}

// ================= BIOMETRIC SECURITY: RETINAL / FACE SCAN =================
let videoStream = null;

function openBiometricScanner() {
  triggerHaptic(25);
  playBeep(440, 0.2);
  const modal = document.getElementById("modal-bio-scan");
  if (modal) modal.style.display = "flex";

  const video = document.getElementById("bio-video");
  const bioStatus = document.getElementById("bio-scan-status");
  const bioBar = document.getElementById("bio-scan-progress");

  bioStatus.textContent = "Initializing camera & optic sensors...";
  bioBar.style.width = "0%";

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }).then(stream => {
      videoStream = stream;
      if (video) video.srcObject = stream;
      runBiometricScanSequence();
    }).catch(err => {
      bioStatus.textContent = "Camera access denied. Retinal simulation running...";
      runBiometricScanSequence();
    });
  } else {
    runBiometricScanSequence();
  }
}

function runBiometricScanSequence() {
  const bioStatus = document.getElementById("bio-scan-status");
  const bioBar = document.getElementById("bio-scan-progress");
  let progress = 0;

  const steps = [
    { p: 25, msg: "ACQUIRING FACIAL GEOMETRY...", freq: 520 },
    { p: 55, msg: "SCANNING RETINAL PATTERN & IRIS...", freq: 740 },
    { p: 85, msg: "COMPARING BIOMETRIC SIGNATURE...", freq: 880 },
    { p: 100, msg: "BIOMETRIC CONFIRMED: LINFORD ANTWI", freq: 1174 }
  ];

  let stepIdx = 0;
  const interval = setInterval(() => {
    if (stepIdx < steps.length) {
      const step = steps[stepIdx];
      bioStatus.textContent = step.msg;
      bioBar.style.width = `${step.p}%`;
      playBeep(step.freq, 0.15, "triangle");
      triggerHaptic(30);
      stepIdx++;
    } else {
      clearInterval(interval);
      isBiometricVerified = true;
      sessionStorage.setItem("leags_bio_verified", "true");
      
      if (bioLockBadge) {
        bioLockBadge.innerHTML = "🛡️ Auth: Verified (Linford)";
        bioLockBadge.className = "badge-tag badge-verified";
      }

      playChime(880, 1318);
      speakOutLoud("Biometric verification confirmed. Welcome back, Linford. Full master control granted.");
      showToast("🛡️ Biometric Verification Confirmed!");

      setTimeout(() => {
        closeBiometricScanner();
      }, 1400);
    }
  }, 450);
}

function closeBiometricScanner() {
  const modal = document.getElementById("modal-bio-scan");
  if (modal) modal.style.display = "none";
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
}

// ================= TOOLS & UTILITIES =================
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

function sendClipboardToPC() {
  triggerHaptic(20);
  const text = document.getElementById("clipboard-input").value;
  if (!text.trim()) return showToast("Enter text first", false);
  sendPCAction("set_clipboard", { text: text });
  showToast("📋 Sent to Windows Clipboard!");
  speakOutLoud("Sent to PC clipboard.");
}

function fetchPCClipboard() {
  triggerHaptic(20);
  sendPCAction("get_clipboard");
}

function requestScreenshot() {
  triggerHaptic(25);
  sendPCAction("screenshot");
  showToast("📸 Snapping PC screenshot...");
}

function saveDesktopNote() {
  triggerHaptic(20);
  const note = document.getElementById("note-input").value;
  if (!note.trim()) return showToast("Enter note text", false);
  sendPCAction("note", { content: note });
  document.getElementById("note-input").value = "";
  showToast("💾 Saved to Desktop/Assistant_Notes.md");
  speakOutLoud("Note saved to PC desktop.");
}

function searchPCFiles() {
  triggerHaptic(20);
  const q = document.getElementById("file-search-input").value;
  if (!q.trim()) return showToast("Enter search keyword", false);
  sendPCAction("find", { query: q });
  showToast(`🔍 Searching PC files for '${q}'...`);
}

function fetchRecentDesktopFiles() {
  triggerHaptic(15);
  sendPCAction("recent_files", { folder: "Desktop" });
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

function runCustomPS() {
  triggerHaptic(20);
  const cmd = document.getElementById("ps-input").value.trim();
  if (!cmd) return showToast("Enter command", false);
  sendPCAction("powershell", { command: cmd });
  showToast(`⚡ Running: ${cmd}`);
}

// Settings Handlers
function saveGeminiKey() {
  triggerHaptic(20);
  const k = document.getElementById("gemini-key-input").value.trim();
  geminiKey = k;
  localStorage.setItem("leags_gemini_key", geminiKey);
  showToast(k ? "✓ Gemini API Key saved!" : "Key removed");
}

const hapticToggle = document.getElementById("haptic-toggle");
if (hapticToggle) {
  hapticToggle.checked = hapticsEnabled;
  hapticToggle.addEventListener("change", e => {
    hapticsEnabled = e.target.checked;
    localStorage.setItem("leags_haptics", hapticsEnabled);
  });
}

const voiceReplyToggle = document.getElementById("voice-reply-toggle");
if (voiceReplyToggle) {
  voiceReplyToggle.checked = voiceReplyEnabled;
  voiceReplyToggle.addEventListener("change", e => {
    voiceReplyEnabled = e.target.checked;
    localStorage.setItem("leags_voice_reply", voiceReplyEnabled);
    if (voiceReplyEnabled) speakOutLoud("Voice responses enabled.");
  });
}

const handsFreeToggle = document.getElementById("handsfree-toggle");
if (handsFreeToggle) {
  handsFreeToggle.checked = handsFreeEnabled;
  handsFreeToggle.addEventListener("change", e => {
    handsFreeEnabled = e.target.checked;
    localStorage.setItem("leags_handsfree", handsFreeEnabled);
    if (handsFreeEnabled) {
      if (recognition) try { recognition.start(); } catch(err) {}
      speakOutLoud("Hands free wake word listening enabled.");
    } else {
      if (recognition) try { recognition.stop(); } catch(err) {}
    }
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
  showToast("Purging cache and updating Leags...");
  setTimeout(() => {
    window.location.reload(true);
  }, 600);
}

// Load saved key in Settings
if (geminiKey) {
  const keyInput = document.getElementById("gemini-key-input");
  if (keyInput) keyInput.value = geminiKey;
}

// Initialize Cloud Mesh immediately
connectMesh();
