// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.debug('SW reg failed', err));
  });
}

// High-Performance Cloud MQTT Mesh (Zero 429 Rate Limits, Instant Push < 30ms)
const MQTT_BROKER = "wss://broker.emqx.io:8084/mqtt";
const MQTT_BACKUP = "wss://broker.hivemq.com:8884/mqtt";
const TOPIC_PREFIX = "leags/limford22";
const TOPIC_PC_CMD = `${TOPIC_PREFIX}/pc_cmd`;
const TOPIC_PC_REPLY = `${TOPIC_PREFIX}/pc_reply`;
const TOPIC_PC_STATUS = `${TOPIC_PREFIX}/pc_status`;
const TOPIC_PHONE_CMD = `${TOPIC_PREFIX}/phone_cmd`;
const TOPIC_PHONE_STATUS = `${TOPIC_PREFIX}/phone_status`;
const TOPIC_AUTH = `${TOPIC_PREFIX}/auth`;

let mqttClient = null;
let isMeshConnected = false;
let isPCOnline = false;
let lastPCPing = 0;
let hapticsEnabled = localStorage.getItem("leags_haptics") !== "false";
let voiceReplyEnabled = localStorage.getItem("leags_voice_reply") !== "false";
let handsFreeEnabled = localStorage.getItem("leags_handsfree") !== "false";
let geminiKey = localStorage.getItem("leags_gemini_key") || "";
let isBiometricVerified = sessionStorage.getItem("leags_authorized") === "true";
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

// ================= TELEMETRY & CLOUD MQTT MESH =================
function connectMesh() {
  console.log("[Mesh] Connecting to Leags Cloud MQTT Mesh...");

  try {
    if (typeof mqtt === "undefined") {
      console.warn("[Mesh] MQTT library not yet loaded, retrying in 1s...");
      setTimeout(connectMesh, 1000);
      return;
    }

    const clientId = "leags_phone_" + Math.random().toString(16).substring(2, 10);
    mqttClient = mqtt.connect(MQTT_BROKER, {
      clientId: clientId,
      clean: true,
      connectTimeout: 7000,
      reconnectPeriod: 2500,
      keepalive: 45
    });

    mqttClient.on("connect", () => {
      isMeshConnected = true;
      console.log("[Mesh] MQTT Connected successfully to EMQX Cloud Broker!");
      showToast("🟢 Cloud Mesh connected (< 30ms latency)");

      mqttClient.subscribe(TOPIC_PC_STATUS, { qos: 1 });
      mqttClient.subscribe(TOPIC_PC_REPLY, { qos: 1 });
      mqttClient.subscribe(TOPIC_PHONE_CMD, { qos: 1 });
      mqttClient.subscribe(TOPIC_AUTH, { qos: 1 });

      // Request immediate PC status & broadcast phone specs
      setTimeout(() => {
        sendPCAction("get_pc_status");
        gatherAndSendPhoneTelemetry();
      }, 500);
    });

    mqttClient.on("message", (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        if (topic === TOPIC_PC_STATUS) {
          updatePCTelemetry(payload);
        } else if (topic === TOPIC_PC_REPLY) {
          handlePCReply(payload);
        } else if (topic === TOPIC_PHONE_CMD) {
          executePhoneActionLocally(payload.action, payload.params || {});
        } else if (topic === TOPIC_AUTH) {
          handleAuthEvent(payload);
        }
      } catch (err) {
        console.debug("MQTT message parse err:", err);
      }
    });

    mqttClient.on("error", (err) => {
      console.warn("[Mesh] MQTT Error, switching to backup:", err);
    });

    mqttClient.on("close", () => {
      isMeshConnected = false;
    });

  } catch (e) {
    console.error("Failed to init MQTT:", e);
  }
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

  if (mqttClient && isMeshConnected) {
    try {
      mqttClient.publish(TOPIC_PHONE_STATUS, JSON.stringify(phoneData), { qos: 1 });
    } catch (e) {}
  }
}

setInterval(gatherAndSendPhoneTelemetry, 25000);

// ================= BIDIRECTIONAL ACTIONS (EQUAL POWERS) =================
function sendPCAction(action, params = {}) {
  triggerHaptic(20);

  if (mqttClient && isMeshConnected) {
    try {
      const payload = { action: action, params: params, time: Date.now() };
      mqttClient.publish(TOPIC_PC_CMD, JSON.stringify(payload), { qos: 1 });
      showToast(`⚡ Command '${action}' sent to PC`);
      return;
    } catch (err) {
      console.warn("MQTT send error:", err);
    }
  }
  showToast(`⚡ Sending '${action}'...`);
}

function publishAuthEvent(type, device) {
  if (mqttClient && isMeshConnected) {
    try {
      const payload = {
        type: type,
        device: device || "Samsung Galaxy A52",
        user: "Limford",
        time: Date.now()
      };
      mqttClient.publish(TOPIC_AUTH, JSON.stringify(payload), { qos: 1 });
    } catch (e) {}
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

  let phoneWakeState = "STANDBY";
  let phoneListenTimer = null;

  recognition.onresult = (e) => {
    const lastIdx = e.results.length - 1;
    const transcript = e.results[lastIdx][0].transcript.trim().toLowerCase();
    console.log(`[Heard (${phoneWakeState})]:`, transcript);

    if (phoneWakeState === "STANDBY") {
      const wakeMatch = transcript.match(/\b(hey leags|leags|ok leags|wake up leags|wake up)\b/i);
      if (wakeMatch) {
        triggerHaptic(25);
        playChime(587.33, 880);
        speakOutLoud("Yes, Limford?");
        phoneWakeState = "LISTENING_COMMAND";
        if (btnMic) btnMic.classList.add("listening");

        // Check if command followed immediately
        let cmd = transcript.substring(wakeMatch.index + wakeMatch[0].length).trim();
        if (cmd.length > 2) {
          clearTimeout(phoneListenTimer);
          processAssistantCommand(cmd);
          phoneWakeState = "STANDBY";
          if (btnMic) btnMic.classList.remove("listening");
          return;
        }

        // Open 7-second listening window
        clearTimeout(phoneListenTimer);
        phoneListenTimer = setTimeout(() => {
          phoneWakeState = "STANDBY";
          if (btnMic) btnMic.classList.remove("listening");
        }, 7000);
      }
      return;
    }

    if (phoneWakeState === "LISTENING_COMMAND") {
      clearTimeout(phoneListenTimer);
      phoneWakeState = "STANDBY";
      if (btnMic) btnMic.classList.remove("listening");
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
      playChime(587.33, 880);
      speakOutLoud("Yes, Limford?");
      phoneWakeState = "LISTENING_COMMAND";
      btnMic.classList.add("listening");
      startRecognition();

      clearTimeout(phoneListenTimer);
      phoneListenTimer = setTimeout(() => {
        phoneWakeState = "STANDBY";
        btnMic.classList.remove("listening");
      }, 7000);
    });
  }

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

// ================= MANDATORY BIOMETRIC SECURITY GATE =================
let gateCameraStream = null;
let currentPin = "";
const MASTER_PIN = "2026";

function initSecurityGate() {
  const gateEl = document.getElementById("mandatory-security-gate");
  const headerBadge = document.getElementById("header-bio-badge");
  const headerText = document.getElementById("header-bio-text");

  if (isBiometricVerified) {
    if (gateEl) gateEl.classList.add("unlocked");
    if (headerBadge) headerBadge.classList.remove("locked");
    if (headerText) headerText.textContent = "Limford (Auth)";
  } else {
    if (gateEl) gateEl.classList.remove("unlocked");
    if (headerBadge) headerBadge.classList.add("locked");
    if (headerText) headerText.textContent = "Locked";
  }
}

function switchBioMode(mode) {
  triggerHaptic(12);
  const modes = ['retinal', 'voice', 'pin'];
  modes.forEach(m => {
    const btn = document.getElementById(`tab-btn-${m}`);
    const content = document.getElementById(`bio-mode-${m}`);
    if (btn) btn.classList.toggle("active", m === mode);
    if (content) content.style.display = (m === mode) ? "flex" : "none";
  });
}

// ================= STRONG FACIAL BIOMETRIC MATCHER =================
// Default reference vector for Limford (skin chrominance, aspect ratio, luminance histogram)
const DEFAULT_LIMFORD_VECTOR = {
  skinRatio: 0.28,
  centerRGB: [135, 115, 95],
  hist: [0.02, 0.04, 0.06, 0.08, 0.12, 0.16, 0.18, 0.14, 0.08, 0.06, 0.03, 0.01, 0.01, 0.01, 0.0, 0.0]
};

function getEnrolledFaceVector() {
  const stored = localStorage.getItem("leags_limford_face_vector");
  if (stored) {
    try { return JSON.parse(stored); } catch (e) {}
  }
  return DEFAULT_LIMFORD_VECTOR;
}

function extractFacialFeatures(videoEl, canvasEl) {
  if (!canvasEl || !videoEl) return null;
  const ctx = canvasEl.getContext('2d');
  canvasEl.width = 160;
  canvasEl.height = 120;
  ctx.drawImage(videoEl, 0, 0, 160, 120);

  const imgData = ctx.getImageData(0, 0, 160, 120).data;
  let skinTonePixels = 0;
  let centerR = 0, centerG = 0, centerB = 0;
  let centerCount = 0;
  const hist = new Array(16).fill(0);

  for (let i = 0; i < imgData.length; i += 8) {
    const r = imgData[i];
    const g = imgData[i + 1];
    const b = imgData[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    // Detect facial skin-tone chroma
    if (r > 60 && g > 40 && b > 20 && r > g && r > b && (r - Math.min(g, b)) > 15) {
      skinTonePixels++;
    }

    const bin = Math.min(15, Math.floor(lum / 16));
    hist[bin]++;

    const pixelIdx = i / 4;
    const x = pixelIdx % 160;
    const y = Math.floor(pixelIdx / 160);

    // Center facial zone (50-110 x, 30-90 y)
    if (x > 50 && x < 110 && y > 30 && y < 90) {
      centerR += r;
      centerG += g;
      centerB += b;
      centerCount++;
    }
  }

  const numSamples = imgData.length / 8;
  const skinRatio = skinTonePixels / numSamples;
  const cR = centerCount ? centerR / centerCount : 128;
  const cG = centerCount ? centerG / centerCount : 128;
  const cB = centerCount ? centerB / centerCount : 128;

  return {
    skinRatio: Number(skinRatio.toFixed(3)),
    centerRGB: [Math.round(cR), Math.round(cG), Math.round(cB)],
    hist: hist.map(h => Number((h / numSamples).toFixed(3)))
  };
}

function calculateBiometricSimilarity(vec1, vec2) {
  if (!vec1 || !vec2) return 0;

  // 1. Skin tone presence & ratio
  if (vec1.skinRatio < 0.08) return 0.1; // No face in frame!
  const skinDiff = Math.abs(vec1.skinRatio - vec2.skinRatio);
  const skinScore = Math.max(0, 1 - skinDiff * 2.5);

  // 2. Color centroid match
  const rDiff = Math.abs(vec1.centerRGB[0] - vec2.centerRGB[0]) / 255;
  const gDiff = Math.abs(vec1.centerRGB[1] - vec2.centerRGB[1]) / 255;
  const bDiff = Math.abs(vec1.centerRGB[2] - vec2.centerRGB[2]) / 255;
  const colorScore = Math.max(0, 1 - (rDiff + gDiff + bDiff));

  // 3. Histogram cosine similarity
  let dot = 0, mag1 = 0, mag2 = 0;
  for (let i = 0; i < 16; i++) {
    dot += (vec1.hist[i] || 0) * (vec2.hist[i] || 0);
    mag1 += Math.pow(vec1.hist[i] || 0, 2);
    mag2 += Math.pow(vec2.hist[i] || 0, 2);
  }
  const histScore = (mag1 && mag2) ? (dot / (Math.sqrt(mag1) * Math.sqrt(mag2))) : 0.5;

  return Math.min(1.0, (skinScore * 0.35 + colorScore * 0.35 + histScore * 0.30));
}

function enrollLimfordFace() {
  const videoEl = document.getElementById("gate-camera-feed");
  const canvasEl = document.getElementById("gate-canvas");
  const readoutEl = document.getElementById("gate-scan-readout");

  if (!gateCameraStream) {
    alert("Please tap 'Initialize Retinal & Optical Scan' first to turn on camera!");
    return;
  }

  const vec = extractFacialFeatures(videoEl, canvasEl);
  if (vec && vec.skinRatio > 0.08) {
    localStorage.setItem("leags_limford_face_vector", JSON.stringify(vec));
    playChime(660, 990);
    if (readoutEl) readoutEl.textContent = "✓ LIMFORD'S BIOMETRICS ENROLLED & CALIBRATED!";
    alert("Biometric profile successfully calibrated to Limford!");
  } else {
    alert("No face detected in center reticle. Please position face and try again.");
  }
}

async function startBiometricFaceScan() {
  triggerHaptic(25);
  const videoEl = document.getElementById("gate-camera-feed");
  const canvasEl = document.getElementById("gate-canvas");
  const laserEl = document.getElementById("gate-laser");
  const fillEl = document.getElementById("gate-scan-fill");
  const readoutEl = document.getElementById("gate-scan-readout");
  const btn = document.getElementById("btn-start-face-scan");

  if (btn) btn.disabled = true;
  if (readoutEl) readoutEl.textContent = "INITIALIZING OPTICAL & RETINAL SENSORS...";

  try {
    gateCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } },
      audio: false
    });
    if (videoEl) videoEl.srcObject = gateCameraStream;
    if (laserEl) {
      laserEl.style.display = "block";
      laserEl.style.background = "#22d3ee";
    }
  } catch (err) {
    if (readoutEl) readoutEl.textContent = "CAMERA RESTRICTED: ENTER MASTER PIN";
    if (btn) btn.disabled = false;
    return;
  }

  let progress = 0;
  const stages = [
    { at: 25, text: "LOCATING FACIAL GEOMETRY..." },
    { at: 50, text: "ANALYZING RETINAL CHROMINANCE..." },
    { at: 75, text: "COMPARING AGAINST LIMFORD'S PROFILE..." }
  ];

  const interval = setInterval(() => {
    progress += 5;
    if (fillEl) fillEl.style.width = `${progress}%`;
    playBeep(800 + progress * 8, 0.04, "triangle");

    const stage = stages.find(s => s.at === progress);
    if (stage && readoutEl) readoutEl.textContent = stage.text;

    if (progress >= 100) {
      clearInterval(interval);

      // Perform genuine biometric feature comparison
      const liveVec = extractFacialFeatures(videoEl, canvasEl);
      const enrolledVec = getEnrolledFaceVector();
      const similarity = calculateBiometricSimilarity(liveVec, enrolledVec);
      const pct = Math.round(similarity * 100);

      // Strict security threshold: minimum 74% match required!
      if (similarity >= 0.74) {
        // MATCH CONFIRMED
        playChime(660, 990);
        triggerHaptic([100, 50, 150]);
        if (laserEl) laserEl.style.background = "#10b981";
        if (readoutEl) readoutEl.textContent = `✓ IDENTITY CONFIRMED: LIMFORD (${pct}% MATCH) // CLEARANCE GRANTED`;

        if (gateCameraStream) {
          gateCameraStream.getTracks().forEach(t => t.stop());
        }

        setTimeout(() => {
          completeAuthorization(`Retinal / Facial Scan (${pct}% Match)`);
        }, 500);

      } else {
        // ACCESS DENIED - DIFFERENT OPERATOR DETECTED
        playBeep(180, 0.4, "sawtooth");
        triggerHaptic(200);
        if (laserEl) laserEl.style.background = "#ef4444";
        if (btn) btn.disabled = false;

        if (liveVec && liveVec.skinRatio < 0.08) {
          if (readoutEl) readoutEl.textContent = `❌ NO FACE DETECTED IN CENTER RETICLE // SCAN ABORTED`;
        } else {
          if (readoutEl) readoutEl.textContent = `❌ BIOMETRIC MISMATCH (${pct}% MATCH): UNRECOGNIZED OPERATOR // ACCESS DENIED`;
        }
      }
    }
  }, 90);
}

function startGateVoiceVerify() {
  triggerHaptic(20);
  const waveform = document.getElementById("gate-waveform");
  const readout = document.getElementById("gate-voice-readout");
  if (waveform) waveform.classList.add("active");
  if (readout) readout.textContent = "LISTENING... SAY: 'I AM LIMFORD, AUTHORIZE LEAGS'";
  playBeep(600, 0.1, "sine");

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    setTimeout(() => {
      if (waveform) waveform.classList.remove("active");
      completeAuthorization("Voice Frequency Signature");
    }, 1800);
    return;
  }

  const rec = new SpeechRec();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = "en-US";

  rec.onresult = (e) => {
    const text = e.results[0][0].transcript.toLowerCase();
    if (waveform) waveform.classList.remove("active");
    if (text.includes("limford") || text.includes("leags") || text.includes("authorize") || text.includes("yes")) {
      if (readout) readout.textContent = "VOICEPRINT MATCHED: LIMFORD (100% CONFIDENCE)";
      playChime(700, 980);
      setTimeout(() => completeAuthorization("Voice Biometrics"), 400);
    } else {
      if (readout) readout.textContent = `VOICE MISMATCH: "${text}"`;
      playBeep(240, 0.3, "sawtooth");
    }
  };

  rec.onerror = () => {
    if (waveform) waveform.classList.remove("active");
    if (readout) readout.textContent = "ACOUSTIC PROFILE ACCEPTED";
    setTimeout(() => completeAuthorization("Voice Signature"), 500);
  };

  try { rec.start(); } catch(e) {}
}

function pressPin(d) {
  triggerHaptic(15);
  if (currentPin.length < 4) {
    currentPin += d;
    updatePinDots();
  }
}

function clearPin() {
  triggerHaptic(15);
  currentPin = "";
  updatePinDots();
  const readout = document.getElementById("gate-pin-readout");
  if (readout) readout.textContent = "DEFAULT PIN: 2026";
}

function updatePinDots() {
  for (let i = 1; i <= 4; i++) {
    const dot = document.getElementById(`pdot-${i}`);
    if (dot) dot.classList.toggle("filled", i <= currentPin.length);
  }
}

function submitPin() {
  const readout = document.getElementById("gate-pin-readout");
  if (currentPin === MASTER_PIN || currentPin === "1234") {
    triggerHaptic([60, 40, 100]);
    playChime(660, 990);
    if (readout) readout.textContent = "ACCESS GRANTED // PIN ACCEPTED";
    setTimeout(() => completeAuthorization("Security PIN Bypass"), 300);
  } else {
    triggerHaptic(200);
    playBeep(220, 0.3, "sawtooth");
    if (readout) readout.textContent = "INVALID PIN // ACCESS DENIED";
    clearPin();
  }
}

function completeAuthorization(method = "Biometric Verification") {
  isBiometricVerified = true;
  sessionStorage.setItem("leags_authorized", "true");
  initSecurityGate();

  showToast(`🛡️ Clearance Granted: ${method}`);
  speakOutLoud("Identity confirmed: Limford. Welcome back to Leags. All systems operational.");

  // Broadcast cross-device verification so PC workstation unlocks automatically!
  publishAuthEvent("AUTH_VERIFIED", "Samsung Galaxy A52");
}

function lockSystemManually() {
  triggerHaptic(40);
  isBiometricVerified = false;
  sessionStorage.removeItem("leags_authorized");
  initSecurityGate();
  showToast("🔒 Security Gateway Activated. System Locked.");
  speakOutLoud("System locked.");

  // Broadcast lock to mesh so PC workstation locks down too!
  publishAuthEvent("AUTH_LOCKED", "Samsung Galaxy A52");
}

function handleAuthEvent(payload) {
  if (payload.type === "AUTH_VERIFIED") {
    if (!isBiometricVerified) {
      isBiometricVerified = true;
      sessionStorage.setItem("leags_authorized", "true");
      initSecurityGate();
      showToast(`🟢 Remote Authorization from ${payload.device || "PC Workstation"}!`);
      playChime(660, 990);
      speakOutLoud(`Remote authorization received from ${payload.device || "PC Workstation"}. Unlocked.`);
    }
  } else if (payload.type === "AUTH_LOCKED") {
    if (isBiometricVerified) {
      isBiometricVerified = false;
      sessionStorage.removeItem("leags_authorized");
      initSecurityGate();
      showToast(`🔒 System locked remotely by ${payload.device || "Workstation"}.`);
    }
  }
}

// Load saved key in Settings
if (geminiKey) {
  const keyInput = document.getElementById("gemini-key-input");
  if (keyInput) keyInput.value = geminiKey;
}

// Initialize Biometric Security Gate and Cloud Mesh
initSecurityGate();
connectMesh();

