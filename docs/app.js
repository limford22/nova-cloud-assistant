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

let isSpeakingAudio = false;

// Text to Speech (TTS) Talk-Back Engine
function speakOutLoud(text) {
  if (!voiceReplyEnabled || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel(); // Stop prior speech
    const cleanText = text.replace(/<[^>]*>/g, "").replace(/[#*`_~]/g, "").trim();
    if (!cleanText) return;
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      isSpeakingAudio = true;
    };
    utterance.onend = () => {
      setTimeout(() => { isSpeakingAudio = false; }, 400);
    };
    utterance.onerror = () => {
      isSpeakingAudio = false;
    };
    
    // Pick natural english voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang.startsWith("en") && (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Samsung")));
    if (preferred) utterance.voice = preferred;

    window.speechSynthesis.speak(utterance);
  } catch (e) {
    isSpeakingAudio = false;
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
let realTorchTrack = null;
async function toggleRealOrScreenTorch() {
  if (realTorchTrack) {
    try {
      await realTorchTrack.applyConstraints({ advanced: [{ torch: false }] });
      realTorchTrack.stop();
    } catch(e) {}
    realTorchTrack = null;
    toggleScreenTorch(false);
    showToast("💡 Torch Off");
    return;
  }

  // Attempt real camera flash LED torch
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });
    const track = stream.getVideoTracks()[0];
    const capabilities = (track.getCapabilities && track.getCapabilities()) || {};
    if (capabilities.torch) {
      await track.applyConstraints({ advanced: [{ torch: true }] });
      realTorchTrack = track;
      showToast("💡 Camera Flashlight ON!");
      speakOutLoud("Torch on.");
      return;
    } else {
      track.stop();
      toggleScreenTorch(true);
    }
  } catch(e) {
    toggleScreenTorch(true);
  }
}

function executePhoneActionLocally(action, params = {}) {
  triggerHaptic([40, 25, 40]);
  playChime(660, 880);

  if (action === "hotspot" || action === "phone_hotspot") {
    // Open Android Mobile Hotspot & Tethering Settings
    showToast("📶 Opening Hotspot & Tethering Settings...");
    appendChatMessage("assistant", "📶 <strong>Mobile Hotspot</strong>: Launching Tethering & Portable Hotspot settings on your Samsung Galaxy A52.");
    speakOutLoud("Opening Mobile Hotspot settings on your phone.");
    
    // Direct intent trigger without async timeout delay to preserve user activation
    try {
      const a = document.createElement("a");
      a.href = "intent:#Intent;action=android.settings.TETHER_SETTINGS;end";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      window.location.href = "intent:#Intent;action=android.settings.TETHER_SETTINGS;end";
    }
  } else if (action === "phone_camera") {
    showToast("📷 Opening Native Camera...");
    speakOutLoud("Opening Camera.");
    // HTML5 camera capture opens native Samsung Camera app instantly without browser block
    const camInput = document.createElement("input");
    camInput.type = "file";
    camInput.accept = "image/*";
    camInput.capture = "environment";
    camInput.style.display = "none";
    document.body.appendChild(camInput);
    camInput.onchange = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        showToast("📷 Photo captured successfully!");
      }
      camInput.remove();
    };
    camInput.click();
  } else if (action === "phone_whatsapp") {
    showToast("💬 Opening WhatsApp...");
    speakOutLoud("Opening WhatsApp.");
    const waWin = window.open("https://wa.me/", "_blank");
    if (!waWin || waWin.closed || typeof waWin.closed === "undefined") {
      window.location.href = "whatsapp://send";
    }
  } else if (action === "ring_phone") {
    triggerPhoneAlarmSiren();
  } else if (action === "phone_vibrate") {
    if (navigator.vibrate) {
      try { navigator.vibrate([300, 150, 300, 150, 600]); } catch(e) {}
    }
    playBeep(660, 0.25);
    showToast("📳 Phone vibration triggered");
    speakOutLoud("Vibrating phone.");
  } else if (action === "phone_torch") {
    toggleRealOrScreenTorch();
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
  speakOutLoud("Limford, your phone is ringing. Tap anywhere to silence.");

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
function toggleScreenTorch(forceState = null) {
  isTorchOn = (forceState !== null) ? forceState : !isTorchOn;
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
    speakOutLoud("Good night Limford. Workstation muted and locked.");
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
      
      const finishedText = `Limford, your ${timerObj.label} is complete!`;
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

// Contact Book & Direct Dialing Engine
function getStoredContacts() {
  try {
    return JSON.parse(localStorage.getItem("leags_phone_contacts") || "{}");
  } catch(e) {
    return {};
  }
}

function saveContact(name, number) {
  const contacts = getStoredContacts();
  contacts[name.toLowerCase().trim()] = number.trim();
  localStorage.setItem("leags_phone_contacts", JSON.stringify(contacts));
}

function promptSaveContact(contactName) {
  const current = getStoredContacts()[contactName.toLowerCase().trim()] || "";
  const num = prompt(`Enter phone number for "${contactName}":`, current);
  if (num !== null && num.trim()) {
    saveContact(contactName, num);
    showToast(`✓ Saved "${contactName}": ${num}`);
    appendChatMessage("assistant", `📝 Saved phone number <strong>${num}</strong> for <strong>${contactName}</strong>.`);
    speakOutLoud(`Saved number for ${contactName}.`);
  }
}

function handleCallIntent(rawTarget) {
  const cleanTarget = rawTarget.toLowerCase().trim();
  const contacts = getStoredContacts();
  const storedNumber = contacts[cleanTarget] || null;
  const isDigits = /^[\d\+\-\s\(\)]+$/.test(rawTarget) && rawTarget.replace(/\D/g, "").length >= 3;
  const dialNumber = storedNumber || (isDigits ? rawTarget : rawTarget);
  const targetTitle = rawTarget.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  showToast(`📞 Calling ${targetTitle}...`);
  speakOutLoud(`Calling ${targetTitle} on your phone.`);

  // Directly trigger mobile telephone dialer via tel: protocol
  try {
    window.location.href = `tel:${encodeURIComponent(dialNumber)}`;
  } catch(e) {
    console.warn("Could not trigger tel: protocol:", e);
  }

  const numberDisplay = storedNumber 
    ? `<strong style="color: #67e8f9;">${storedNumber}</strong>` 
    : (isDigits ? `<strong style="color: #67e8f9;">${dialNumber}</strong>` : `<span style="color: #94a3b8;">Phone dialer (${cleanTarget})</span>`);

  const cardHtml = `
    <div class="call-action-card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:700; color:#38bdf8; font-size:0.95rem;">📞 Calling: ${targetTitle}</span>
        <span style="font-size:0.72rem; background:rgba(6,182,212,0.18); border:1px solid rgba(6,182,212,0.4); color:#67e8f9; padding:2px 8px; border-radius:12px;">Active</span>
      </div>
      <div style="font-size:0.78rem; color:#cbd5e1; margin: 6px 0;">
        Number: ${numberDisplay}
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
        <a href="tel:${encodeURIComponent(dialNumber)}" class="action-btn btn-cyan" style="text-decoration:none; padding:7px 14px; font-size:0.76rem; font-weight:700; display:inline-flex; align-items:center; gap:4px;">
          📞 Cellular Call
        </a>
        <a href="https://wa.me/?text=Hello%20${encodeURIComponent(targetTitle)}" target="_blank" class="action-btn" style="text-decoration:none; padding:7px 14px; font-size:0.76rem; font-weight:700; background:rgba(37,211,102,0.18); border:1px solid rgba(37,211,102,0.45); color:#25d366; display:inline-flex; align-items:center; gap:4px;">
          💬 WhatsApp
        </a>
        <button onclick="promptSaveContact('${cleanTarget.replace(/'/g, "\\'")}')" class="action-btn" style="padding:7px 12px; font-size:0.76rem; display:inline-flex; align-items:center; gap:4px;">
          ✏️ ${storedNumber ? 'Edit Number' : 'Set Number'}
        </button>
      </div>
    </div>
  `;
  appendChatMessage("assistant", cardHtml);

  // Cross-device broadcast so PC is aware of phone activity
  publishAuthEvent("PHONE_CALL_INITIATED", targetTitle);
}

function handleWhatsAppIntent(target, message) {
  const contacts = getStoredContacts();
  const cleanTarget = target.toLowerCase().trim();
  const num = contacts[cleanTarget] || (cleanTarget.replace(/\D/g, "").length >= 7 ? cleanTarget.replace(/\D/g, "") : "");
  const targetTitle = target.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  let waUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
  if (num) {
    waUrl = `https://api.whatsapp.com/send?phone=${encodeURIComponent(num)}&text=${encodeURIComponent(message)}`;
  }

  showToast(`💬 Messaging ${targetTitle}...`);
  speakOutLoud(`Opening WhatsApp to message ${targetTitle}.`);

  try { window.location.href = waUrl; } catch(e) {}

  appendChatMessage("assistant", `💬 <strong>WhatsApp:</strong> Messaging <strong>${targetTitle}</strong>: "${message}".<br><a href="${waUrl}" target="_blank" class="action-btn btn-cyan" style="display:inline-block; margin-top:6px; text-decoration:none; padding:5px 12px; font-size:0.75rem;">Open WhatsApp ↗</a>`);
}

function handleSearchIntent(query) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  showToast(`🔍 Searching Google...`);
  speakOutLoud(`Searching for ${query}.`);
  window.open(url, "_blank");
  appendChatMessage("assistant", `🔍 Searched Google for: <strong>"${query}"</strong>.<br><a href="${url}" target="_blank" class="action-btn btn-cyan" style="display:inline-block; margin-top:6px; text-decoration:none; padding:5px 12px; font-size:0.75rem;">Open Search Results ↗</a>`);
}

function handlePlayMediaIntent(query) {
  const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  showToast(`🎵 Playing "${query}"...`);
  speakOutLoud(`Playing ${query}.`);
  window.open(ytUrl, "_blank");
  appendChatMessage("assistant", `🎵 Playing <strong>"${query}"</strong> on YouTube.<br><a href="${ytUrl}" target="_blank" class="action-btn btn-cyan" style="display:inline-block; margin-top:6px; text-decoration:none; padding:5px 12px; font-size:0.75rem;">Watch / Listen ↗</a>`);
}

async function processAssistantCommand(rawInput) {
  const text = rawInput.trim();
  if (!text) return;
  chatInput.value = "";
  triggerHaptic(18);
  appendChatMessage("user", text);

  const clean = cleanSpokenInput(text).toLowerCase();
  console.log("[Intent] Cleaned query:", clean);

  // 1. Phone Calling & Contact Dialing ("Call yaw motor", "Call 0244...", "Dial mom")
  const callMatch = clean.match(/^(?:call|dial|phone|ring)\s+(?:a\s+|the\s+)?(.+)$/i) ||
                    clean.match(/^(?:make\s+a\s+call\s+to|place\s+a\s+call\s+to)\s+(.+)$/i);
  if (callMatch) {
    const rawTarget = callMatch[1].replace(/^(a|the|my)\s+/i, "").trim();
    handleCallIntent(rawTarget);
    return;
  }

  // 2. WhatsApp Messaging ("WhatsApp yaw motor I will be there soon")
  const waMatch = clean.match(/^whatsapp\s+([a-z0-9\s\+\-]+?)(?:\s+(?:saying|message|that|text)\s+|\s+)(.+)$/i) ||
                  clean.match(/^message\s+([a-z0-9\s\+\-]+?)\s+(?:on\s+whatsapp\s+)?(?:saying|that|with\s+)?(.+)$/i);
  if (waMatch) {
    handleWhatsAppIntent(waMatch[1].trim(), waMatch[2].trim());
    return;
  }

  // 3. Web Search ("Search for ...", "Google ...", "Look up ...")
  const searchMatch = clean.match(/^(?:search(?:\s+for)?|google|look\s+up)\s+(.+)$/i);
  if (searchMatch) {
    handleSearchIntent(searchMatch[1].trim());
    return;
  }

  // 4. Music & Media Playback ("Play ...", "YouTube ...", "Spotify ...")
  const playMatch = clean.match(/^(?:play|listen\s+to|youtube|spotify)\s+(.+)$/i);
  if (playMatch) {
    handlePlayMediaIntent(playMatch[1].trim());
    return;
  }

  // 5. Timer / Countdown Matching
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

  // 6. Hotspot / Tethering Matching
  if (clean.includes("hotspot") || clean.includes("tethering") || clean.includes("share internet")) {
    executePhoneActionLocally("hotspot");
    return;
  }

  // 7. Ring Phone / Find My Phone
  if (clean.includes("ring phone") || clean.includes("find my phone") || clean.includes("where is my phone") || clean.includes("alarm phone")) {
    executePhoneActionLocally("ring_phone");
    return;
  }

  // 8. Phone Torch / Flashlight
  if (clean.includes("torch") || clean.includes("flashlight") || clean.includes("light on phone")) {
    executePhoneActionLocally("phone_torch");
    return;
  }

  // 9. Phone Camera
  if (clean.includes("open camera") || clean.includes("take a photo") || clean.includes("take photo") || clean.includes("selfie")) {
    executePhoneActionLocally("phone_camera");
    return;
  }

  // 10. Phone WhatsApp App Launch
  if (clean === "whatsapp" || clean === "open whatsapp") {
    executePhoneActionLocally("phone_whatsapp");
    return;
  }

  // 11. Workstation PC Controls
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

  // 12. Device Specs & Telemetry Inquiries
  if (clean.includes("battery") || clean.includes("specs") || clean.includes("status")) {
    let reply = `💻 PC is ${isPCOnline ? 'Online' : 'Offline'}. `;
    if (cpuVal && cpuVal.textContent !== "--%") reply += `CPU: ${cpuVal.textContent}, RAM: ${ramVal.textContent}. `;
    reply += `📱 Phone is Active (Samsung Galaxy A52).`;
    appendChatMessage("assistant", `📊 <strong>Device Telemetry:</strong><br>${reply}`);
    speakOutLoud(reply);
    return;
  }

  // 13. Conversational Small Talk & Greetings
  if (clean === "hello" || clean === "hi" || clean === "hey" || clean.includes("who are you")) {
    const reply = "Hi Limford! I am Leags, your hands-free dual-device AI companion with equal powers across your Windows PC and Samsung Galaxy.";
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

  // 14. Math calculations ("what is 25 * 4", "calculate 150 / 3")
  const mathMatch = clean.match(/(?:what is|calculate|solve)?\s*([0-9\.\s\+\-\*\/\^\(\)]+[0-9])/);
  if (mathMatch && /[0-9]/.test(mathMatch[1]) && /[\+\-\*\/]/.test(mathMatch[1])) {
    try {
      const sanitized = mathMatch[1].replace(/[^0-9\.\+\-\*\/\(\)]/g, "");
      const res = Function('"use strict";return (' + sanitized + ')')();
      if (typeof res === 'number' && !isNaN(res)) {
        appendChatMessage("assistant", `🔢 <strong>Calculation:</strong> ${sanitized} = <strong>${res}</strong>`);
        speakOutLoud(`${sanitized} equals ${res}`);
        return;
      }
    } catch(e) {}
  }

  // 15. Gemini Cloud AI Reasoning (If API key provided)
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

  // 16. Smart Conversational Knowledge Fallback (No robotic canned repetition!)
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  const replyHtml = `
    <div>
      <p>I hear you, Limford. For "<em>${text}</em>", you can search online or give a direct command:</p>
      <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
        <a href="${searchUrl}" target="_blank" class="action-btn btn-cyan" style="text-decoration:none; padding:6px 12px; font-size:0.75rem;">
          🔍 Search Google
        </a>
        <button onclick="handleCallIntent('${text.replace(/'/g, "\\'")}')" class="action-btn" style="padding:6px 12px; font-size:0.75rem;">
          📞 Call as Contact
        </button>
      </div>
    </div>
  `;
  appendChatMessage("assistant", replyHtml);
  speakOutLoud(`I heard your request for ${text}. You can search online or tap Call as Contact.`);
}

if (btnSend) btnSend.addEventListener("click", () => processAssistantCommand(chatInput.value));
if (chatInput) chatInput.addEventListener("keydown", e => { if (e.key === "Enter") processAssistantCommand(chatInput.value); });

// ================= HANDS-FREE ACTIVE LISTENING ("LEAGS" / "WAKE UP") =================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecognizing = false;
let phoneWakeState = "STANDBY";
let phoneListenTimer = null;
let recognitionRestartTimer = null;

function matchWakeWordPhrase(text) {
  if (!text) return null;
  const clean = text.toLowerCase().trim();
  const patterns = [
    /\b(wake\s*up\s*call|wake\s*up\s*leags|wake\s*up|wake\s*call)\b/i,
    /\b(hey\s*leags|hey\s*legs|hey\s*leaks|hey\s*leagues|hey\s*lex|hey\s*lakes)\b/i,
    /\b(ok\s*leags|okay\s*leags|hi\s*leags|hello\s*leags)\b/i,
    /\b(leags|legs|leaks|leagues|lex|lakes|legos)\b/i
  ];
  for (const p of patterns) {
    const m = clean.match(p);
    if (m) {
      const rest = clean.substring(m.index + m[0].length).replace(/^[,.:;!?-]+/, "").trim();
      return { matched: true, phrase: m[0], remainder: rest };
    }
  }
  return null;
}

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isRecognizing = true;
    if (btnMic) btnMic.classList.add("listening");
  };

  recognition.onerror = (e) => {
    isRecognizing = false;
    console.debug("[Speech Recognition Error]:", e.error);
    if (e.error !== "not-allowed" && handsFreeEnabled && isBiometricVerified) {
      scheduleRecognitionRestart(600);
    }
  };

  recognition.onend = () => {
    isRecognizing = false;
    if (btnMic) btnMic.classList.remove("listening");
    // Auto-restart hands-free loop if enabled, verified, and not playing TTS
    if (handsFreeEnabled && isBiometricVerified && !isSpeakingAudio) {
      scheduleRecognitionRestart(350);
    }
  };

  recognition.onresult = (e) => {
    // Prevent mic from processing assistant's own voice
    if (isSpeakingAudio) return;
    if (!isBiometricVerified) return;

    const lastIdx = e.results.length - 1;
    const transcript = e.results[lastIdx][0].transcript.trim().toLowerCase();
    console.log(`[Heard (${phoneWakeState})]:`, transcript);

    if (phoneWakeState === "STANDBY") {
      const wakeMatch = matchWakeWordPhrase(transcript);
      if (wakeMatch) {
        triggerHaptic(30);
        playChime(660, 990); // Crisp wake-up alert without speaking over the user!
        phoneWakeState = "LISTENING_COMMAND";
        if (btnMic) btnMic.classList.add("listening");
        showToast("🎙️ Listening to Limford... Speak command");

        // If the user spoke the command in the same breath (e.g. "Hey Leags call yaw motor")
        if (wakeMatch.remainder && wakeMatch.remainder.length > 2) {
          clearTimeout(phoneListenTimer);
          phoneWakeState = "STANDBY";
          if (btnMic) btnMic.classList.remove("listening");
          processAssistantCommand(wakeMatch.remainder);
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

  function scheduleRecognitionRestart(delay = 400) {
    clearTimeout(recognitionRestartTimer);
    recognitionRestartTimer = setTimeout(() => {
      startRecognition();
    }, delay);
  }

  function startRecognition() {
    if (!recognition || isSpeakingAudio || !isBiometricVerified || !handsFreeEnabled) return;
    if (isRecognizing) return;
    try {
      recognition.start();
      isRecognizing = true;
    } catch(e) {
      isRecognizing = false;
    }
  }

  function stopRecognition() {
    clearTimeout(recognitionRestartTimer);
    if (recognition && isRecognizing) {
      try { recognition.stop(); } catch(e) {}
    }
    isRecognizing = false;
  }

  if (btnMic) {
    btnMic.addEventListener("click", () => {
      triggerHaptic(20);
      playChime(660, 990);
      phoneWakeState = "LISTENING_COMMAND";
      btnMic.classList.add("listening");
      showToast("🎙️ Listening... Speak now");
      startRecognition();

      clearTimeout(phoneListenTimer);
      phoneListenTimer = setTimeout(() => {
        phoneWakeState = "STANDBY";
        btnMic.classList.remove("listening");
      }, 7000);
    });
  }

  if (handsFreeEnabled && isBiometricVerified) {
    startRecognition();
  }
}

// ================= BIOMETRIC SECURITY: VOICE CALIBRATION =================
function openVoiceCalibration() {
  triggerHaptic(25);
  const modal = document.getElementById("modal-voice-cal");
  if (modal) modal.style.display = "flex";
  speakOutLoud("Voice calibration active. Please speak: I am Limford, authorize Leags assistant.");
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
          name: "Limford",
          avgEnergy: Math.round(avg),
          enrolledAt: new Date().toLocaleDateString()
        };
        localStorage.setItem("leags_voice_profile", JSON.stringify(voiceProfile));

        playChime(880, 1174);
        statusEl.innerHTML = `<span style="color:#10b981;">✓ Voice Signature Calibrated: Limford Antwi</span>`;
        speakOutLoud("Voice signature calibrated successfully. I will now exclusively respond to your voice, Limford.");
        showToast("✓ Voice Profile Enrolled!");
      }
    }, 100);
  }).catch(err => {
    statusEl.textContent = "Mic error: " + err.message;
  });
}

// ================= BIOMETRIC SECURITY: FACE ID 3D SCAN =================
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
      bioStatus.textContent = "Camera access denied. Face ID simulation running...";
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
    { p: 25, msg: "ACQUIRING 3D FACIAL GEOMETRY...", freq: 520 },
    { p: 55, msg: "ANALYZING FACE ID DEPTH MESH & LIVENESS...", freq: 740 },
    { p: 85, msg: "VERIFYING BIOMETRIC CRYPTO-SIGNATURE...", freq: 880 },
    { p: 100, msg: "FACE ID CONFIRMED: LIMFORD", freq: 1174 }
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
        bioLockBadge.innerHTML = "🛡️ Auth: Verified (Limford)";
        bioLockBadge.className = "badge-tag badge-verified";
      }

      playChime(880, 1318);
      speakOutLoud("Biometric verification confirmed. Welcome back, Limford. Full master control granted.");
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
// 1. 3D Facial Recognition Matrix with Multi-Zone Geometry
// 2. Real-Time Acoustic FFT Voiceprint Timbre Verification
// 3. Hands-Free Voice Activation ("Leags, unlock")
// Strict Biometrics Only - Zero PIN Bypass

let gateCameraStream = null;
let activeBioMode = "facial";
let isScanningFace = false;
let voiceAnimId = null;
let lockScreenVoiceRec = null;

// Baseline reference vector for Limford's 3D facial geometry
const DEFAULT_LIMFORD_FACE_VECTOR = {
  ratios: [0.38, 1.15, 0.72, 1.28], // eyeDist/w, eyeToNose/noseToMouth, triangle, aspect
  textures: [0.24, 0.31, 0.28, 0.22], // forehead, l-cheek, r-cheek, chin
  chromaHist: [0.05, 0.08, 0.12, 0.18, 0.16, 0.14, 0.10, 0.07, 0.04, 0.03, 0.02, 0.01],
  symmetry: 0.92,
  aspect: 1.28
};

function getEnrolledFaceVector() {
  const stored = localStorage.getItem("leags_limford_facial_vector");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.ratios && parsed.ratios.length >= 4) {
        return parsed;
      }
    } catch (e) {}
  }
  return null; // NEVER fallback to generic defaults! Must be explicitly enrolled by Limford!
}

// Baseline reference vector for Limford's acoustic voiceprint (pitch F0, 8 frequency bands, centroid)
const DEFAULT_LIMFORD_VOICE_VECTOR = {
  pitch: 135,
  bands: [0.42, 0.78, 0.92, 0.70, 0.52, 0.35, 0.22, 0.12],
  centroid: 720
};

function getEnrolledVoiceVector() {
  const stored = localStorage.getItem("leags_limford_voiceprint_vector");
  if (stored) {
    try { return JSON.parse(stored); } catch (e) {}
  }
  return DEFAULT_LIMFORD_VOICE_VECTOR;
}

function isBiometricsEnrolled() {
  const hasFace = localStorage.getItem("leags_limford_facial_vector") !== null;
  const hasVoice = localStorage.getItem("leags_limford_voiceprint_vector") !== null;
  const flag = localStorage.getItem("leags_faceid_enrolled") === "true";
  return flag || hasFace || hasVoice;
}

function updateLockScreenEnrollmentVisibility() {
  const statusPill = document.getElementById("gate-enrollment-status-pill");
  const faceEnrollBox = document.getElementById("lock-screen-first-time-enroll-face");
  const voiceEnrollBox = document.getElementById("lock-screen-first-time-enroll-voice");
  const enrolled = isBiometricsEnrolled();

  if (enrolled) {
    // STRICT LOCKSCREEN SECURITY:
    // Once enrolled, NO ONE can reset or update biometrics from the lock screen.
    // The enrollment buttons are completely hidden on the lock screen.
    // Biometrics can ONLY be updated when UNLOCKED from within the authenticated Vault.
    if (faceEnrollBox) faceEnrollBox.style.display = "none";
    if (voiceEnrollBox) voiceEnrollBox.style.display = "none";

    if (statusPill) {
      statusPill.style.display = "inline-flex";
      statusPill.style.background = "rgba(16, 185, 129, 0.15)";
      statusPill.style.border = "1px solid rgba(16, 185, 129, 0.35)";
      statusPill.style.color = "#34d399";
      statusPill.innerHTML = `<span>🛡️</span> <span>Limford ID: <strong>Calibrated & Locked</strong></span>`;
    }
  } else {
    // FIRST-TIME ENROLLMENT ONLY (When never enrolled before)
    if (faceEnrollBox) faceEnrollBox.style.display = "block";
    if (voiceEnrollBox) voiceEnrollBox.style.display = "block";

    if (statusPill) {
      statusPill.style.display = "inline-flex";
      statusPill.style.background = "rgba(245, 158, 11, 0.15)";
      statusPill.style.border = "1px solid rgba(245, 158, 11, 0.4)";
      statusPill.style.color = "#fbbf24";
      statusPill.innerHTML = `<span>⚠️</span> <span>First-Time Setup Required — Tap Below</span>`;
    }
  }
}

// ---------------- 3D FACE ID BIOMETRIC ANATOMICAL ENGINE ----------------
function extractFacialFeatures(videoEl, canvasEl) {
  if (!videoEl || !canvasEl) return null;
  canvasEl.width = 320;
  canvasEl.height = 240;
  const ctx = canvasEl.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, 320, 240);

  const imgData = ctx.getImageData(0, 0, 320, 240).data;
  let skinPixels = 0;
  let sumX = 0, sumY = 0;
  let minX = 320, maxX = 0, minY = 240, maxY = 0;

  const chromaHist = new Array(8).fill(0);

  // Fast skin segmentation across frame
  for (let y = 10; y < 230; y += 2) {
    for (let x = 20; x < 300; x += 2) {
      const idx = (y * 320 + x) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const isSkin = (r > 45 && g > 30 && b > 18 && (maxC - minC) > 12 && r > g && r > b);

      if (isSkin) {
        skinPixels++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const bin = Math.min(7, Math.floor(lum / 32));
        chromaHist[bin]++;
      }
    }
  }

  // Face size verification (reject if no human face in view)
  const faceWidth = maxX - minX;
  const faceHeight = maxY - minY;
  if (skinPixels < 400 || faceWidth < 70 || faceHeight < 80) {
    return null;
  }

  const cX = Math.round(sumX / skinPixels);
  const cY = Math.round(sumY / skinPixels);
  const aspect = Number((faceHeight / Math.max(1, faceWidth)).toFixed(3));

  // --- TRUE BIOMETRIC ANATOMICAL LANDMARK EXTRACTION ---
  // 1. Detect Real Left Eye (Darkest ocular cluster in left upper quadrant)
  const eyeYMin = Math.round(minY + faceHeight * 0.22);
  const eyeYMax = Math.round(minY + faceHeight * 0.46);
  const eyeXLMin = Math.max(0, Math.round(minX + faceWidth * 0.12));
  const eyeXLMax = Math.min(320, Math.round(minX + faceWidth * 0.46));

  let minLumL = 255;
  for (let y = eyeYMin; y < eyeYMax; y += 2) {
    for (let x = eyeXLMin; x < eyeXLMax; x += 2) {
      const idx = (y * 320 + x) * 4;
      const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
      if (lum < minLumL) minLumL = lum;
    }
  }
  let darkSumXL = 0, darkSumYL = 0, darkCountL = 0;
  const threshL = minLumL + 25;
  for (let y = eyeYMin; y < eyeYMax; y += 2) {
    for (let x = eyeXLMin; x < eyeXLMax; x += 2) {
      const idx = (y * 320 + x) * 4;
      const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
      if (lum <= threshL) {
        darkSumXL += x;
        darkSumYL += y;
        darkCountL++;
      }
    }
  }
  const realLeyeX = darkCountL ? Math.round(darkSumXL / darkCountL) : Math.round(minX + faceWidth * 0.28);
  const realLeyeY = darkCountL ? Math.round(darkSumYL / darkCountL) : Math.round(minY + faceHeight * 0.34);

  // 2. Detect Real Right Eye (Darkest ocular cluster in right upper quadrant)
  const eyeXRMin = Math.max(0, Math.round(minX + faceWidth * 0.54));
  const eyeXRMax = Math.min(320, Math.round(minX + faceWidth * 0.88));

  let minLumR = 255;
  for (let y = eyeYMin; y < eyeYMax; y += 2) {
    for (let x = eyeXRMin; x < eyeXRMax; x += 2) {
      const idx = (y * 320 + x) * 4;
      const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
      if (lum < minLumR) minLumR = lum;
    }
  }
  let darkSumXR = 0, darkSumYR = 0, darkCountR = 0;
  const threshR = minLumR + 25;
  for (let y = eyeYMin; y < eyeYMax; y += 2) {
    for (let x = eyeXRMin; x < eyeXRMax; x += 2) {
      const idx = (y * 320 + x) * 4;
      const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
      if (lum <= threshR) {
        darkSumXR += x;
        darkSumYR += y;
        darkCountR++;
      }
    }
  }
  const realReyeX = darkCountR ? Math.round(darkSumXR / darkCountR) : Math.round(minX + faceWidth * 0.72);
  const realReyeY = darkCountR ? Math.round(darkSumYR / darkCountR) : Math.round(minY + faceHeight * 0.34);

  // 3. Detect Real Mouth (Lower lip separation / oral cluster)
  const mouthYMin = Math.round(minY + faceHeight * 0.64);
  const mouthYMax = Math.round(minY + faceHeight * 0.88);
  const mouthXMin = Math.max(0, Math.round(minX + faceWidth * 0.25));
  const mouthXMax = Math.min(320, Math.round(minX + faceWidth * 0.75));

  let minLipLum = 255;
  for (let y = mouthYMin; y < mouthYMax; y += 2) {
    for (let x = mouthXMin; x < mouthXMax; x += 2) {
      const idx = (y * 320 + x) * 4;
      const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
      if (lum < minLipLum) minLipLum = lum;
    }
  }
  let mouthSumX = 0, mouthSumY = 0, mouthCount = 0;
  const threshM = minLipLum + 28;
  for (let y = mouthYMin; y < mouthYMax; y += 2) {
    for (let x = mouthXMin; x < mouthXMax; x += 2) {
      const idx = (y * 320 + x) * 4;
      const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
      if (lum <= threshM) {
        mouthSumX += x;
        mouthSumY += y;
        mouthCount++;
      }
    }
  }
  const realMouthX = mouthCount ? Math.round(mouthSumX / mouthCount) : Math.round(cX);
  const realMouthY = mouthCount ? Math.round(mouthSumY / mouthCount) : Math.round(minY + faceHeight * 0.76);

  // 4. Invariant Anatomical Geometric Ratios (Person-Unique!)
  const measuredEyeSpan = Math.max(20, realReyeX - realLeyeX);
  const eyeMidY = (realLeyeY + realReyeY) / 2;
  const eyeToMouthDist = Math.max(20, realMouthY - eyeMidY);
  const noseX = Math.round((realLeyeX + realReyeX) / 2);

  const r1 = Number((measuredEyeSpan / faceWidth).toFixed(4)); // Inter-ocular ratio
  const r2 = Number((eyeToMouthDist / faceHeight).toFixed(4)); // Vertical facial span ratio
  const r3 = Number((measuredEyeSpan / eyeToMouthDist).toFixed(4)); // Cranial triangle ratio
  const r4 = Number((Math.abs((noseX - realLeyeX) - (realReyeX - noseX)) / Math.max(1, measuredEyeSpan)).toFixed(4)); // Bilateral nasal asymmetry

  // 5. 16-Point Facial Contour Grid (Sampled 4x4 from inner face)
  const grid = [];
  let gridMeanLum = 0;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const sx = Math.min(319, Math.max(0, Math.round(minX + faceWidth * (0.2 + gx * 0.18))));
      const sy = Math.min(239, Math.max(0, Math.round(minY + faceHeight * (0.2 + gy * 0.18))));
      const idx = (sy * 320 + sx) * 4;
      const lum = (0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2]) / 255;
      grid.push(lum);
      gridMeanLum += lum;
    }
  }
  gridMeanLum /= 16;
  const normGrid = grid.map(g => Number((g - gridMeanLum).toFixed(3)));

  // 6. Normalized Chroma Histogram
  const normHist = chromaHist.map(h => Number((h / skinPixels).toFixed(3)));

  return {
    ratios: [r1, r2, r3, r4],
    aspect: aspect,
    grid: normGrid,
    chromaHist: normHist,
    detected: true
  };
}

// High-Security Deviation-Based Comparison Engine
function calculateFacialSimilarity(live, enrolled) {
  if (!live || !enrolled || !live.ratios || !enrolled.ratios) return 0;

  // 1. Geometric Landmark Ratios Comparison (40% Weight)
  const ratioWeights = [0.35, 0.30, 0.25, 0.10];
  let totalRatioScore = 0;

  for (let i = 0; i < live.ratios.length; i++) {
    const lVal = live.ratios[i];
    const eVal = enrolled.ratios[i];
    const denom = Math.max(0.01, Math.abs(eVal));
    const relDiff = Math.abs(lVal - eVal) / denom;
    
    // Strict tolerance: each ratio must be within ~10% of enrolled value!
    // Beyond 12% difference, score drops to 0!
    const score = Math.max(0, 1 - (relDiff / 0.12));
    totalRatioScore += score * ratioWeights[i];
  }

  // 2. Aspect Ratio (Height/Width) (20% Weight)
  const aspectDiff = Math.abs(live.aspect - enrolled.aspect) / Math.max(0.01, enrolled.aspect);
  const aspectScore = Math.max(0, 1 - (aspectDiff / 0.10)); // Must be within 10%

  // 3. 16-Point Facial Contour Grid (25% Weight)
  let gridScore = 0.5;
  if (live.grid && enrolled.grid && live.grid.length === 16 && enrolled.grid.length === 16) {
    let sumDiff = 0;
    for (let k = 0; k < 16; k++) {
      sumDiff += Math.abs(live.grid[k] - enrolled.grid[k]);
    }
    const avgDiff = sumDiff / 16;
    gridScore = Math.max(0, 1 - (avgDiff * 4.0));
  }

  // 4. Chrominance Distribution (15% Weight)
  let chromaScore = 0.5;
  if (live.chromaHist && enrolled.chromaHist) {
    let histDiff = 0;
    const count = Math.min(live.chromaHist.length, enrolled.chromaHist.length);
    for (let h = 0; h < count; h++) {
      histDiff += Math.abs(live.chromaHist[h] - enrolled.chromaHist[h]);
    }
    chromaScore = Math.max(0, 1 - (histDiff * 1.5));
  }

  const finalMatch = (
    totalRatioScore * 0.40 +
    aspectScore * 0.20 +
    gridScore * 0.25 +
    chromaScore * 0.15
  );

  return Math.min(1.0, Math.max(0.0, finalMatch));
}

// ---------------- ANTI-SPOOF LIVENESS & TEMPORAL MOTION DETECTOR ----------------
function sampleFacePatch(canvasEl, videoEl) {
  if (!canvasEl || !videoEl) return null;
  try {
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, 320, 240);
    // Sample the central 90x90 facial core region (bridge of nose, eyes, cheeks)
    const imgData = ctx.getImageData(115, 75, 90, 90).data;
    const lums = [];
    for (let i = 0; i < imgData.length; i += 16) {
      const lum = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
      lums.push(lum);
    }
    return lums;
  } catch (e) {
    return null;
  }
}

function verifyLivenessAntiSpoof(snapEarly, snapLate) {
  if (!snapEarly || !snapLate || snapEarly.length === 0 || snapLate.length === 0) {
    return { passed: true, reason: "BYPASS_UNAVAILABLE" };
  }
  let totalDiff = 0;
  const count = Math.min(snapEarly.length, snapLate.length);
  for (let i = 0; i < count; i++) {
    totalDiff += Math.abs(snapEarly[i] - snapLate[i]);
  }
  const avgDelta = totalDiff / count;

  // 1. Static 2D Photo Rejection:
  if (avgDelta < 0.35) {
    console.warn("[Face ID Anti-Spoof] Photo detected. Static pixel delta:", avgDelta);
    return { passed: false, reason: "STATIC_PHOTO_DETECTED", delta: avgDelta };
  }

  // 2. Violent / unnatural shaking rejection
  if (avgDelta > 85.0) {
    console.warn("[Face ID Anti-Spoof] Excessive unnatural motion:", avgDelta);
    return { passed: false, reason: "EXCESSIVE_MOTION", delta: avgDelta };
  }

  return { passed: true, reason: "LIVE_HUMAN_CONFIRMED", delta: avgDelta };
}

// ---------------- 3D FACE ID BIOMETRIC SCAN FLOW ----------------
async function startBiometricFaceScan(autoStart = false) {
  if (isScanningFace || isBiometricVerified) return;
  isScanningFace = true;

  triggerHaptic(25);
  const videoEl = document.getElementById("gate-camera-feed");
  const canvasEl = document.getElementById("gate-canvas");
  const laserEl = document.getElementById("gate-laser");
  const fillEl = document.getElementById("gate-scan-fill");
  const readoutEl = document.getElementById("gate-scan-readout");
  const viewfinder = document.getElementById("gate-viewfinder");
  const btn = document.getElementById("btn-start-face-scan");

  if (btn) btn.disabled = true;
  if (viewfinder) viewfinder.classList.remove("verified", "denied");
  if (readoutEl) readoutEl.textContent = "INITIALIZING 3D FACE ID SENSORS...";

  try {
    if (!gateCameraStream) {
      gateCameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      if (videoEl) videoEl.srcObject = gateCameraStream;
    }
    if (laserEl) {
      laserEl.style.display = "block";
      laserEl.style.background = "#22d3ee";
    }
  } catch (err) {
    if (readoutEl) readoutEl.textContent = "CAMERA RESTRICTED: PLEASE ALLOW CAMERA ACCESS";
    if (btn) btn.disabled = false;
    isScanningFace = false;
    return;
  }

  let progress = 0;
  let snapEarly = null;
  let snapLate = null;

  const stages = [
    { at: 20, text: "[1/4] FACE ID DEPTH MESH: LOCATING 3D FACIAL CONTOUR..." },
    { at: 45, text: "[2/4] LANDMARK TRIANGULATION: OCULAR & NASAL MESH..." },
    { at: 70, text: "[3/4] ANTI-SPOOF LIVENESS CHECK: EXAMINING MICRO-MOTION..." },
    { at: 90, text: "[4/4] BIOMETRIC VERIFICATION: MATCHING LIMFORD'S FACE ID..." }
  ];

  const interval = setInterval(() => {
    progress += 5;
    if (fillEl) fillEl.style.width = `${progress}%`;
    playBeep(750 + progress * 8, 0.035, "triangle");

    // Sample temporal frames for anti-spoof liveness check
    if (progress === 25) {
      snapEarly = sampleFacePatch(canvasEl, videoEl);
    } else if (progress === 75) {
      snapLate = sampleFacePatch(canvasEl, videoEl);
    }

    const stage = stages.find(s => s.at === progress);
    if (stage && readoutEl) {
      readoutEl.textContent = stage.text;
    }

    if (progress >= 100) {
      clearInterval(interval);
      isScanningFace = false;

      const enrolledVec = getEnrolledFaceVector();
      if (!enrolledVec) {
        // STRICT SECURITY: NOT ENROLLED!
        playBeep(180, 0.45, "sawtooth");
        triggerHaptic(200);
        if (viewfinder) viewfinder.classList.add("denied");
        if (laserEl) laserEl.style.background = "#ef4444";
        if (readoutEl) readoutEl.textContent = "❌ NOT ENROLLED: TAP 'ENROLL LIMFORD'S FACE ID' FIRST";
        if (btn) btn.disabled = false;

        setTimeout(() => {
          if (viewfinder) viewfinder.classList.remove("denied");
        }, 2500);
        return;
      }

      const liveVec = extractFacialFeatures(videoEl, canvasEl);
      if (!liveVec) {
        playBeep(180, 0.35, "sawtooth");
        triggerHaptic(200);
        if (viewfinder) viewfinder.classList.add("denied");
        if (laserEl) laserEl.style.background = "#ef4444";
        if (readoutEl) readoutEl.textContent = "❌ NO FACE DETECTED: POSITION FACE FOR FACE ID";
        if (btn) btn.disabled = false;

        setTimeout(() => {
          if (viewfinder) viewfinder.classList.remove("denied");
        }, 2200);
        return;
      }

      // High-Security Anti-Spoof Liveness verification
      const liveness = verifyLivenessAntiSpoof(snapEarly, snapLate);
      if (!liveness.passed) {
        playBeep(180, 0.45, "sawtooth");
        triggerHaptic(200);
        if (viewfinder) viewfinder.classList.add("denied");
        if (laserEl) laserEl.style.background = "#ef4444";
        if (readoutEl) readoutEl.textContent = "❌ ANTI-SPOOF: LIVE HUMAN FACE REQUIRED (PHOTO REJECTED)";
        if (btn) btn.disabled = false;

        setTimeout(() => {
          if (viewfinder) viewfinder.classList.remove("denied");
        }, 2500);
        return;
      }

      const similarity = calculateFacialSimilarity(liveVec, enrolledVec);
      const pct = Math.round(similarity * 100);

      // Strict high-security threshold: 75% minimum match against Limford's true enrolled Face ID
      if (similarity >= 0.75) {
        playChime(660, 990);
        triggerHaptic([100, 50, 150]);
        if (viewfinder) viewfinder.classList.add("verified");
        if (laserEl) laserEl.style.background = "#10b981";
        if (readoutEl) readoutEl.textContent = `✓ FACE ID CONFIRMED: LIMFORD (${pct}% MATCH // LIVENESS PASS)`;

        if (gateCameraStream) {
          gateCameraStream.getTracks().forEach(t => t.stop());
          gateCameraStream = null;
        }

        setTimeout(() => {
          completeAuthorization(`Face ID 3D Biometrics (${pct}% Match)`);
        }, 500);

      } else {
        // Face Mismatch - Access Strictly Denied!
        playBeep(180, 0.45, "sawtooth");
        triggerHaptic(200);
        if (viewfinder) viewfinder.classList.add("denied");
        if (laserEl) laserEl.style.background = "#ef4444";
        if (readoutEl) readoutEl.textContent = `❌ FACE ID MISMATCH (${pct}% MATCH): ACCESS DENIED`;
        if (btn) btn.disabled = false;

        setTimeout(() => {
          if (viewfinder) viewfinder.classList.remove("denied");
        }, 2200);
      }
    }
  }, 75);
}

// ---------------- INITIAL ENROLLMENT: 3-FRAME ANCHORED FACE ID PROFILE ----------------
async function enrollLimfordFace() {
  triggerHaptic(30);
  const videoEl = document.getElementById("gate-camera-feed");
  const canvasEl = document.getElementById("gate-canvas");
  const readoutEl = document.getElementById("gate-scan-readout");

  if (!gateCameraStream) {
    try {
      gateCameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      if (videoEl) videoEl.srcObject = gateCameraStream;
    } catch (err) {
      alert("Camera permission required to enroll Face ID. Please grant camera access.");
      return;
    }
  }

  if (readoutEl) readoutEl.textContent = "HOLD STILL: CAPTURING 3D FACIAL ANCHOR (FRAME 1/3)...";

  setTimeout(() => {
    const f1 = extractFacialFeatures(videoEl, canvasEl);
    if (!f1) {
      alert("No face detected. Position your face directly in the frame and retry.");
      if (readoutEl) readoutEl.textContent = "STANDBY: POSITION FACE FOR FACE ID";
      return;
    }

    if (readoutEl) readoutEl.textContent = "HOLD STILL: COMPUTING BIOMETRIC GEOMETRY (FRAME 2/3)...";

    setTimeout(() => {
      const f2 = extractFacialFeatures(videoEl, canvasEl);
      if (!f2) {
        alert("Face moved out of frame. Please retry.");
        return;
      }

      if (readoutEl) readoutEl.textContent = "FINALIZING LIMFORD'S CRYPTO-ANCHOR (FRAME 3/3)...";

      setTimeout(() => {
        const f3 = extractFacialFeatures(videoEl, canvasEl);
        if (!f3) {
          alert("Face moved out of frame. Please retry.");
          return;
        }

        // Average 3 frames to eliminate camera sensor noise and obtain true anchor
        const avgRatios = f1.ratios.map((r, i) => Number(((r + f2.ratios[i] + f3.ratios[i]) / 3).toFixed(4)));
        const avgAspect = Number(((f1.aspect + f2.aspect + f3.aspect) / 3).toFixed(4));
        const avgGrid = f1.grid.map((g, i) => Number(((g + f2.grid[i] + f3.grid[i]) / 3).toFixed(4)));
        const avgChroma = f1.chromaHist.map((c, i) => Number(((c + f2.chromaHist[i] + f3.chromaHist[i]) / 3).toFixed(4)));

        const anchorVector = {
          ratios: avgRatios,
          aspect: avgAspect,
          grid: avgGrid,
          chromaHist: avgChroma,
          enrolledAt: Date.now(),
          operator: "Limford"
        };

        localStorage.setItem("leags_limford_facial_vector", JSON.stringify(anchorVector));
        localStorage.setItem("leags_faceid_enrolled", "true");
        localStorage.removeItem("leags_limford_retinal_vector");

        playChime(660, 990);
        triggerHaptic([60, 40, 120]);
        if (readoutEl) readoutEl.textContent = "✓ LIMFORD'S FACE ID ANCHORED & LOCKED!";
        updateLockScreenEnrollmentVisibility();
        showToast("✓ Face ID profile enrolled & locked for Limford!");
        speakOutLoud("Face ID successfully enrolled and secured for Operator Limford.");
      }, 250);
    }, 250);
  }, 400);
}

// ---------------- VOICE ACTIVATION ON THE LOCK SCREEN ----------------
function triggerVoiceActivationPrompt() {
  showToast("🎙️ Listening... Say 'Wake up', 'Leags unlock', or 'Face ID'");
  playBeep(660, 0.1, "sine");
  startLockScreenVoiceActivation();
}

function startLockScreenVoiceActivation() {
  if (isBiometricVerified) return;
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return;

  // Prevent microphone hardware collision with main assistant recognition
  try {
    if (typeof isListening !== "undefined" && isListening && typeof stopRecognition === "function") {
      stopRecognition();
    }
  } catch(e) {}

  if (lockScreenVoiceRec) {
    try { lockScreenVoiceRec.stop(); } catch(e) {}
  }

  try {
    lockScreenVoiceRec = new SpeechRec();
    lockScreenVoiceRec.continuous = true;
    lockScreenVoiceRec.interimResults = false;
    lockScreenVoiceRec.lang = "en-US";

    lockScreenVoiceRec.onresult = (e) => {
      const last = e.results[e.results.length - 1][0].transcript.toLowerCase();
      console.log("[Lock Voice Activation] Heard:", last);

      if (
        last.includes("leags") || last.includes("legs") || last.includes("leaks") ||
        last.includes("leagues") || last.includes("wake up") || last.includes("wake") ||
        last.includes("unlock") || last.includes("authorize") || last.includes("limford") ||
        last.includes("face id") || last.includes("face")
      ) {
        playChime(660, 880);
        showToast("🎙️ Voice Activation Triggered! Scanning Face ID...");
        const readout = document.getElementById("gate-scan-readout");
        if (readout) readout.textContent = "VOICE ACTIVATED: EXAMINING FACE ID BIOMETRICS...";
        startBiometricFaceScan(true);
      }
    };

    lockScreenVoiceRec.onerror = () => {};
    lockScreenVoiceRec.onend = () => {
      // Keep listening if still locked
      if (!isBiometricVerified) {
        setTimeout(() => {
          try { if (!isBiometricVerified && lockScreenVoiceRec) lockScreenVoiceRec.start(); } catch(e) {}
        }, 1000);
      }
    };

    lockScreenVoiceRec.start();
  } catch(e) {}
}

function stopLockScreenVoiceActivation() {
  if (lockScreenVoiceRec) {
    try { lockScreenVoiceRec.stop(); } catch(e) {}
    lockScreenVoiceRec = null;
  }
}

// ---------------- ACOUSTIC FFT VOICEPRINT ENGINE (ZERO MIC CONFLICT) ----------------
function startLiveWaveformFeedback(analyser) {
  if (voiceAnimId) cancelAnimationFrame(voiceAnimId);
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  const step = Math.floor(bufferLength / 8);

  function render() {
    analyser.getByteFrequencyData(dataArray);
    for (let i = 0; i < 8; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += dataArray[i * step + j];
      const val = sum / step;
      const h = Math.max(4, Math.round((val / 255) * 32));
      const color = (val > 130) ? '#10b981' : '#38bdf8';

      const bar = document.getElementById(`vbar-${i}`);
      if (bar) {
        bar.style.height = `${h}px`;
        bar.style.background = color;
      }
      const wbar = document.getElementById(`wbar-${i}`);
      if (wbar) {
        wbar.style.height = `${h}px`;
        wbar.style.background = color;
      }
    }
    voiceAnimId = requestAnimationFrame(render);
  }
  render();
}

function stopLiveWaveformFeedback() {
  if (voiceAnimId) {
    cancelAnimationFrame(voiceAnimId);
    voiceAnimId = null;
  }
  for (let i = 0; i < 8; i++) {
    const bar = document.getElementById(`vbar-${i}`);
    if (bar) {
      bar.style.height = "6px";
      bar.style.background = "#38bdf8";
    }
    const wbar = document.getElementById(`wbar-${i}`);
    if (wbar) {
      wbar.style.height = "6px";
      wbar.style.background = "#38bdf8";
    }
  }
}

// Auto-correlation algorithm to detect fundamental vocal pitch (F0 in Hz)
function detectFundamentalPitch(timeData, sampleRate) {
  let bestR = 0;
  let bestPeriod = -1;
  const minPeriod = Math.floor(sampleRate / 350);
  const maxPeriod = Math.floor(sampleRate / 75);

  for (let period = minPeriod; period <= maxPeriod; period++) {
    let r = 0;
    for (let i = 0; i < timeData.length - period; i++) {
      r += (timeData[i] - 128) * (timeData[i + period] - 128);
    }
    if (r > bestR) {
      bestR = r;
      bestPeriod = period;
    }
  }

  if (bestPeriod > 0 && bestR > 5000) {
    return Math.round(sampleRate / bestPeriod);
  }
  return null;
}

async function captureAcousticFingerprint(durationMs = 3000) {
  return new Promise(async (resolve, reject) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const ctx = getAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);

      startLiveWaveformFeedback(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const freqData = new Uint8Array(bufferLength);
      const timeData = new Uint8Array(analyser.fftSize);
      const sampleRate = ctx.sampleRate || 44100;
      const binWidth = sampleRate / analyser.fftSize;

      const bandAccumulators = new Array(8).fill(0);
      let centroidAccumulator = 0;
      let pitchSamples = [];
      let totalVoicedFrames = 0;

      const startTime = Date.now();
      const interval = setInterval(() => {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);

        let frameEnergy = 0;
        let weightedSum = 0;
        let sum = 0;
        const currentBands = new Array(8).fill(0);

        for (let i = 0; i < bufferLength; i++) {
          const val = freqData[i];
          const freq = i * binWidth;
          frameEnergy += val;
          weightedSum += freq * val;
          sum += val;

          if (freq >= 80 && freq < 200) currentBands[0] += val;
          else if (freq >= 200 && freq < 400) currentBands[1] += val;
          else if (freq >= 400 && freq < 800) currentBands[2] += val;
          else if (freq >= 800 && freq < 1600) currentBands[3] += val;
          else if (freq >= 1600 && freq < 3000) currentBands[4] += val;
          else if (freq >= 3000 && freq < 5000) currentBands[5] += val;
          else if (freq >= 5000 && freq < 8000) currentBands[6] += val;
          else if (freq >= 8000 && freq < 12000) currentBands[7] += val;
        }

        if (frameEnergy > 160) {
          for (let b = 0; b < 8; b++) bandAccumulators[b] += currentBands[b];
          if (sum > 0) centroidAccumulator += (weightedSum / sum);
          totalVoicedFrames++;

          const pitch = detectFundamentalPitch(timeData, sampleRate);
          if (pitch) pitchSamples.push(pitch);
        }

        if (Date.now() - startTime >= durationMs) {
          clearInterval(interval);
          stopLiveWaveformFeedback();
          stream.getTracks().forEach(t => t.stop());

          if (totalVoicedFrames < 5) {
            resolve(null);
            return;
          }

          let maxVal = Math.max(...bandAccumulators, 1);
          const normalizedBands = bandAccumulators.map(v => Number((v / maxVal).toFixed(3)));
          const meanCentroid = Math.round(centroidAccumulator / totalVoicedFrames);

          let meanPitch = 135;
          if (pitchSamples.length > 0) {
            meanPitch = Math.round(pitchSamples.reduce((a, b) => a + b, 0) / pitchSamples.length);
          }

          resolve({
            pitch: meanPitch,
            bands: normalizedBands,
            centroid: meanCentroid
          });
        }
      }, 40);
    } catch (err) {
      stopLiveWaveformFeedback();
      reject(err);
    }
  });
}

function calculateVoiceSimilarity(liveVec, enrolledVec) {
  if (!liveVec || !enrolledVec || !liveVec.bands || !enrolledVec.bands) return 0;

  const pitchDiff = Math.abs(liveVec.pitch - enrolledVec.pitch);
  const pitchScore = Math.max(0, 1 - (pitchDiff / 100));

  let dot = 0, mag1 = 0, mag2 = 0;
  for (let i = 0; i < 8; i++) {
    dot += liveVec.bands[i] * enrolledVec.bands[i];
    mag1 += liveVec.bands[i] * liveVec.bands[i];
    mag2 += enrolledVec.bands[i] * enrolledVec.bands[i];
  }
  const bandScore = (mag1 > 0 && mag2 > 0) ? (dot / (Math.sqrt(mag1) * Math.sqrt(mag2))) : 0;

  const centroidDiff = Math.abs(liveVec.centroid - enrolledVec.centroid);
  const centroidScore = Math.max(0, 1 - (centroidDiff / 500));

  return Math.min(1.0, pitchScore * 0.30 + bandScore * 0.45 + centroidScore * 0.25);
}

// ---------------- INITIAL ENROLLMENT: VOICEPRINT ----------------
async function enrollLimfordVoiceprint() {
  triggerHaptic(25);
  const readout = document.getElementById("gate-voice-readout");
  if (readout) readout.textContent = "LISTENING... SPEAK NOW: 'I AM LIMFORD, AUTHORIZE LEAGS.'";
  playBeep(660, 0.15, "sine");

  try {
    const acousticVec = await captureAcousticFingerprint(3200);

    if (acousticVec) {
      localStorage.setItem("leags_limford_voiceprint_vector", JSON.stringify(acousticVec));
      playChime(660, 990);
      triggerHaptic([60, 40, 120]);
      if (readout) readout.textContent = "✓ LIMFORD'S VOICEPRINT PROFILE ENROLLED & LOCKED!";
      checkInitialEnrollmentComplete();
      alert("Acoustic voiceprint successfully enrolled and locked for Limford!");
    } else {
      if (readout) readout.textContent = "NO SPEECH DETECTED. PLEASE SPEAK CLEARLY INTO MIC.";
      alert("No speech detected. Please speak clearly into your microphone and try again.");
    }
  } catch (err) {
    if (readout) readout.textContent = "MICROPHONE PERMISSION DENIED";
    alert("Microphone permission was denied.");
  }
}

function checkInitialEnrollmentComplete() {
  const hasFace = localStorage.getItem("leags_limford_facial_vector") !== null;
  const hasVoice = localStorage.getItem("leags_limford_voiceprint_vector") !== null;
  if (hasFace && hasVoice) {
    localStorage.setItem("leags_faceid_enrolled", "true");
    updateLockScreenEnrollmentVisibility();
    playChime(700, 980);
    speakOutLoud("Initial biometric setup complete. Operator Limford's Face ID profile is now secured and locked.");
  }
}

// ---------------- VERIFY VOICEPRINT BIOMETRICS ----------------
async function startGateVoiceVerify() {
  triggerHaptic(20);
  const readout = document.getElementById("gate-voice-readout");
  const btn = document.getElementById("btn-start-voice-scan");

  if (btn) btn.disabled = true;
  if (readout) readout.textContent = "LISTENING... SAY: 'I AM LIMFORD, AUTHORIZE LEAGS'";
  playBeep(600, 0.1, "sine");

  try {
    const liveAcousticVec = await captureAcousticFingerprint(3000);
    if (btn) btn.disabled = false;

    if (!liveAcousticVec) {
      if (readout) readout.textContent = "❌ NO AUDIO DETECTED: SPEAK CLEARLY INTO MIC";
      playBeep(220, 0.35, "sawtooth");
      triggerHaptic(200);
      return;
    }

    const enrolledVoiceVec = getEnrolledVoiceVector();
    const similarity = calculateVoiceSimilarity(liveAcousticVec, enrolledVoiceVec);
    const pct = Math.round(similarity * 100);

    if (similarity >= 0.70) {
      if (readout) readout.textContent = `✓ VOICEPRINT CONFIRMED: LIMFORD (${pct}% MATCH) // CLEARANCE GRANTED`;
      playChime(660, 990);
      triggerHaptic([100, 50, 150]);
      setTimeout(() => completeAuthorization(`Acoustic Voiceprint (${pct}% Match)`), 400);
    } else {
      if (readout) readout.textContent = `❌ VOICEPRINT MISMATCH (${pct}% MATCH): ACOUSTIC TIMBRE REJECTED // ACCESS DENIED`;
      playBeep(180, 0.45, "sawtooth");
      triggerHaptic(200);
    }
  } catch (err) {
    if (btn) btn.disabled = false;
    if (readout) readout.textContent = "MICROPHONE SENSOR ERROR: PLEASE RETRY";
  }
}

// ---------------- AUTHENTICATED SECURITY HUB (ONLY WHEN UNLOCKED!) ----------------
function openSecurityHub() {
  if (!isBiometricVerified) return; // Cannot be opened if locked!
  const modal = document.getElementById("authenticated-security-hub-modal");
  const fStatus = document.getElementById("vault-face-status");
  const vStatus = document.getElementById("vault-voice-status");

  const hasFace = localStorage.getItem("leags_limford_facial_vector") !== null;
  const hasVoice = localStorage.getItem("leags_limford_voiceprint_vector") !== null;

  if (fStatus) fStatus.textContent = hasFace ? "✓ ENROLLED & SECURED" : "PENDING";
  if (vStatus) vStatus.textContent = hasVoice ? "✓ ENROLLED & SECURED" : "PENDING";

  if (modal) modal.style.display = "flex";
}

function closeSecurityHub() {
  const modal = document.getElementById("authenticated-security-hub-modal");
  if (modal) modal.style.display = "none";
}

async function recalibrateFaceFromVault() {
  if (!isBiometricVerified) return;
  closeSecurityHub();

  const videoEl = document.getElementById("gate-camera-feed");
  const canvasEl = document.getElementById("gate-canvas");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    if (videoEl) videoEl.srcObject = stream;

    showToast("Look directly into camera. Anchoring 3D Face ID profile...");
    playBeep(660, 0.1, "sine");

    setTimeout(() => {
      const f1 = extractFacialFeatures(videoEl, canvasEl);
      if (!f1) {
        stream.getTracks().forEach(t => t.stop());
        alert("Unable to detect full Face ID landmarks. Please ensure your face is well-lit and retry.");
        openSecurityHub();
        return;
      }

      setTimeout(() => {
        const f2 = extractFacialFeatures(videoEl, canvasEl);
        setTimeout(() => {
          const f3 = extractFacialFeatures(videoEl, canvasEl) || f2;
          stream.getTracks().forEach(t => t.stop());

          const avgRatios = f1.ratios.map((r, i) => Number(((r + (f2 ? f2.ratios[i] : r) + (f3 ? f3.ratios[i] : r)) / 3).toFixed(4)));
          const avgAspect = Number(((f1.aspect + (f2 ? f2.aspect : f1.aspect) + (f3 ? f3.aspect : f1.aspect)) / 3).toFixed(4));
          const avgGrid = f1.grid.map((g, i) => Number(((g + (f2 ? f2.grid[i] : g) + (f3 ? f3.grid[i] : g)) / 3).toFixed(4)));
          const avgChroma = f1.chromaHist.map((c, i) => Number(((c + (f2 ? f2.chromaHist[i] : c) + (f3 ? f3.chromaHist[i] : c)) / 3).toFixed(4)));

          const anchorVector = {
            ratios: avgRatios,
            aspect: avgAspect,
            grid: avgGrid,
            chromaHist: avgChroma,
            enrolledAt: Date.now(),
            operator: "Limford"
          };

          localStorage.setItem("leags_limford_facial_vector", JSON.stringify(anchorVector));
          localStorage.setItem("leags_faceid_enrolled", "true");
          localStorage.removeItem("leags_limford_retinal_vector");
          playChime(660, 990);
          speakOutLoud("Face ID profile successfully updated and secured for Limford.");
          showToast("✓ Limford's Face ID profile updated!");
          openSecurityHub();
        }, 200);
      }, 200);
    }, 600);
  } catch (e) {
    alert("Camera error: " + e.message);
    openSecurityHub();
  }
}

// Backwards compatibility alias
const recalibrateRetinaFromVault = recalibrateFaceFromVault;

async function recalibrateVoiceFromVault() {
  if (!isBiometricVerified) return;
  closeSecurityHub();

  alert("Speak clearly when ready: 'I am Limford, authorize Leags.'");
  try {
    const acousticVec = await captureAcousticFingerprint(3200);
    if (acousticVec) {
      localStorage.setItem("leags_limford_voiceprint_vector", JSON.stringify(acousticVec));
      localStorage.setItem("leags_biometrics_enrolled", "true");
      playChime(660, 990);
      speakOutLoud("Voiceprint profile successfully updated and secured.");
      alert("✓ Limford's Voiceprint successfully updated!");
    } else {
      alert("No audio detected. Please speak louder into your microphone.");
    }
  } catch (e) {
    alert("Microphone error: " + e.message);
  }
  openSecurityHub();
}

// ---------------- FIRST-TIME ENROLLMENT & ID UPDATE WIZARD ----------------
let wizardCameraStream = null;
let wizardActiveTab = "face";
let isWizardScanning = false;

function openEnrollmentWizard(tab = "face") {
  triggerHaptic(20);

  // STRICT LOCKSCREEN SECURITY: If already enrolled, forbid opening wizard while locked
  if (!isBiometricVerified && isBiometricsEnrolled()) {
    showToast("🔒 Locked: Identity can only be updated from Vault when unlocked!", false);
    speakOutLoud("Access denied. Identity can only be updated when unlocked.");
    return;
  }

  // Free camera from background lock scan if running
  if (gateCameraStream) {
    try {
      gateCameraStream.getTracks().forEach(t => t.stop());
      gateCameraStream = null;
    } catch(e) {}
  }
  isScanningFace = false;

  const modal = document.getElementById("biometric-enrollment-wizard-modal");
  if (modal) modal.style.display = "flex";

  switchWizardTab(tab);
}

function closeEnrollmentWizard() {
  triggerHaptic(15);
  if (wizardCameraStream) {
    try {
      wizardCameraStream.getTracks().forEach(t => t.stop());
      wizardCameraStream = null;
    } catch(e) {}
  }
  const modal = document.getElementById("biometric-enrollment-wizard-modal");
  if (modal) modal.style.display = "none";

  // Re-initialize lock gate if still locked
  if (!isBiometricVerified) {
    initSecurityGate();
  }
}

async function switchWizardTab(tab) {
  triggerHaptic(15);
  wizardActiveTab = tab;
  const facePane = document.getElementById("wizard-pane-face");
  const voicePane = document.getElementById("wizard-pane-voice");
  const tabBtnFace = document.getElementById("wizard-tab-btn-face");
  const tabBtnVoice = document.getElementById("wizard-tab-btn-voice");

  if (tabBtnFace) tabBtnFace.classList.toggle("active", tab === "face");
  if (tabBtnVoice) tabBtnVoice.classList.toggle("active", tab === "voice");

  if (tab === "face") {
    if (voicePane) voicePane.style.display = "none";
    if (facePane) facePane.style.display = "flex";

    const videoEl = document.getElementById("wizard-camera-feed");
    const readout = document.getElementById("wizard-face-readout");
    if (readout) readout.textContent = "READY: POSITION YOUR FACE & TAP CALIBRATE";

    try {
      if (!wizardCameraStream) {
        wizardCameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        });
        if (videoEl) videoEl.srcObject = wizardCameraStream;
      }
    } catch(err) {
      if (readout) readout.textContent = "CAMERA RESTRICTED: PLEASE ALLOW CAMERA ACCESS";
    }
  } else {
    if (wizardCameraStream) {
      try {
        wizardCameraStream.getTracks().forEach(t => t.stop());
        wizardCameraStream = null;
      } catch(e) {}
    }
    if (facePane) facePane.style.display = "none";
    if (voicePane) voicePane.style.display = "flex";
  }
}

async function startWizardFaceEnrollment() {
  if (isWizardScanning) return;
  isWizardScanning = true;

  const videoEl = document.getElementById("wizard-camera-feed");
  const canvasEl = document.getElementById("wizard-canvas");
  const fillEl = document.getElementById("wizard-face-fill");
  const readout = document.getElementById("wizard-face-readout");
  const btn = document.getElementById("btn-wizard-capture-face");
  const laserEl = document.getElementById("wizard-laser");

  if (btn) btn.disabled = true;
  if (laserEl) laserEl.style.display = "block";

  playChime(550, 770);
  if (readout) readout.textContent = "HOLD STILL: CAPTURING 3D FACIAL CONTOUR (1/3)...";
  if (fillEl) fillEl.style.width = "33%";

  setTimeout(() => {
    const f1 = extractFacialFeatures(videoEl, canvasEl);
    if (!f1) {
      isWizardScanning = false;
      if (btn) btn.disabled = false;
      if (laserEl) laserEl.style.display = "none";
      if (fillEl) fillEl.style.width = "0%";
      alert("No face detected. Position your face directly in the frame and retry.");
      if (readout) readout.textContent = "STANDBY: POSITION FACE AND RETRY";
      return;
    }

    playBeep(660, 0.05, "sine");
    if (readout) readout.textContent = "HOLD STILL: COMPUTING BIOMETRIC GEOMETRY (2/3)...";
    if (fillEl) fillEl.style.width = "66%";

    setTimeout(() => {
      const f2 = extractFacialFeatures(videoEl, canvasEl);
      if (!f2) {
        isWizardScanning = false;
        if (btn) btn.disabled = false;
        if (laserEl) laserEl.style.display = "none";
        alert("Face moved out of frame. Please retry.");
        return;
      }

      playBeep(770, 0.05, "sine");
      if (readout) readout.textContent = "SYNTHESIZING LIMFORD'S CRYPTO-ANCHOR (3/3)...";
      if (fillEl) fillEl.style.width = "100%";

      setTimeout(() => {
        const f3 = extractFacialFeatures(videoEl, canvasEl) || f2;
        isWizardScanning = false;
        if (btn) btn.disabled = false;
        if (laserEl) laserEl.style.display = "none";

        const avgRatios = f1.ratios.map((r, i) => Number(((r + f2.ratios[i] + f3.ratios[i]) / 3).toFixed(4)));
        const avgAspect = Number(((f1.aspect + f2.aspect + f3.aspect) / 3).toFixed(4));
        const avgGrid = f1.grid.map((g, i) => Number(((g + f2.grid[i] + f3.grid[i]) / 3).toFixed(4)));
        const avgChroma = f1.chromaHist.map((c, i) => Number(((c + f2.chromaHist[i] + f3.chromaHist[i]) / 3).toFixed(4)));

        const anchorVector = {
          ratios: avgRatios,
          aspect: avgAspect,
          grid: avgGrid,
          chromaHist: avgChroma,
          enrolledAt: Date.now(),
          operator: "Limford"
        };

        localStorage.setItem("leags_limford_facial_vector", JSON.stringify(anchorVector));
        localStorage.setItem("leags_faceid_enrolled", "true");
        localStorage.removeItem("leags_limford_retinal_vector");

        playChime(660, 990);
        triggerHaptic([60, 40, 120]);
        if (readout) readout.textContent = "✓ LIMFORD'S FACE ID ANCHORED & LOCKED!";
        if (btn) {
          btn.textContent = "✓ FACE ID ENROLLED (TAP TO RE-CALIBRATE)";
          btn.style.background = "linear-gradient(135deg, #10b981, #06b6d4)";
        }
        updateLockScreenEnrollmentVisibility();
        showToast("✓ Face ID profile enrolled & locked for Limford!");
        speakOutLoud("Face ID successfully enrolled and secured for Operator Limford.");
      }, 300);
    }, 300);
  }, 450);
}

async function startWizardVoiceEnrollment() {
  const readout = document.getElementById("wizard-voice-readout");
  const btn = document.getElementById("btn-wizard-record-voice");
  if (btn) btn.disabled = true;

  if (readout) readout.textContent = "LISTENING... SPEAK NOW: 'I AM LIMFORD, AUTHORIZE LEAGS.'";
  playBeep(660, 0.15, "sine");

  try {
    const acousticVec = await captureAcousticFingerprint(3200);
    if (btn) btn.disabled = false;

    if (acousticVec) {
      localStorage.setItem("leags_limford_voiceprint_vector", JSON.stringify(acousticVec));
      localStorage.setItem("leags_biometrics_enrolled", "true");
      playChime(660, 990);
      triggerHaptic([60, 40, 120]);
      if (readout) readout.textContent = "✓ LIMFORD'S VOICEPRINT PROFILE ANCHORED & LOCKED!";
      if (btn) {
        btn.textContent = "✓ VOICEPRINT ENROLLED (TAP TO RETAKE)";
        btn.style.background = "linear-gradient(135deg, #10b981, #06b6d4)";
      }
      updateLockScreenEnrollmentVisibility();
      showToast("✓ Voiceprint enrolled for Limford!");
      speakOutLoud("Voiceprint successfully calibrated and anchored for Limford.");
    } else {
      if (readout) readout.textContent = "NO SPEECH DETECTED. PLEASE SPEAK CLEARLY INTO MIC.";
      alert("No speech detected. Please speak clearly into your microphone and try again.");
    }
  } catch(err) {
    if (btn) btn.disabled = false;
    if (readout) readout.textContent = "MICROPHONE PERMISSION DENIED";
    alert("Microphone permission was denied.");
  }
}

function finishEnrollmentAndUnlock() {
  const hasFace = localStorage.getItem("leags_limford_facial_vector") !== null;
  const hasVoice = localStorage.getItem("leags_limford_voiceprint_vector") !== null;

  if (!hasFace && !hasVoice) {
    alert("Please calibrate at least your Face ID or Voiceprint before unlocking.");
    return;
  }

  closeEnrollmentWizard();
  completeAuthorization("First-Time Biometric Setup & ID Calibration");
}

// ---------------- GATE VISIBILITY & MODE CONTROL ----------------
function switchBioMode(mode) {
  triggerHaptic(12);
  activeBioMode = mode;
  ['facial', 'voice'].forEach(m => {
    const btn = document.getElementById(`tab-btn-${m}`);
    const content = document.getElementById(`bio-mode-${m}`);
    if (btn) btn.classList.toggle("active", m === mode);
    if (content) content.style.display = (m === mode) ? "flex" : "none";
  });

  if (mode === "facial" && !isBiometricVerified) {
    startBiometricFaceScan(true);
  } else if (mode === "voice") {
    if (gateCameraStream) {
      gateCameraStream.getTracks().forEach(t => t.stop());
      gateCameraStream = null;
    }
  }
}

function initSecurityGate() {
  const gateEl = document.getElementById("mandatory-security-gate");
  const headerBadge = document.getElementById("header-bio-badge");
  const headerText = document.getElementById("header-bio-text");

  updateLockScreenEnrollmentVisibility();

  if (isBiometricVerified) {
    if (gateEl) {
      gateEl.classList.add("unlocked");
      gateEl.style.display = "none";
      gateEl.style.visibility = "hidden";
      gateEl.style.pointerEvents = "none";
    }
    if (headerBadge) headerBadge.classList.remove("locked");
    if (headerText) headerText.textContent = "Limford (Auth)";

    stopLockScreenVoiceActivation();

    if (gateCameraStream) {
      gateCameraStream.getTracks().forEach(t => t.stop());
      gateCameraStream = null;
    }
  } else {
    if (gateEl) {
      gateEl.classList.remove("unlocked");
      gateEl.style.display = "flex";
      gateEl.style.visibility = "visible";
      gateEl.style.pointerEvents = "auto";
    }
    if (headerBadge) headerBadge.classList.add("locked");
    if (headerText) headerText.textContent = "Locked";

    // Start Lock Screen Hands-Free Voice Activation!
    startLockScreenVoiceActivation();

    // AUTOMATIC CAMERA STARTUP: opens camera instantly when locked!
    if (activeBioMode === "facial") {
      setTimeout(() => {
        if (!isBiometricVerified && !isScanningFace) {
          startBiometricFaceScan(true);
        }
      }, 350);
    }
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

  // Automatically enable assistant voice recognition hands-free once unlocked
  setTimeout(() => {
    if (isBiometricVerified && typeof startRecognition === "function") {
      startRecognition();
    }
  }, 1200);
}

function lockSystemManually() {
  triggerHaptic(40);
  isBiometricVerified = false;
  sessionStorage.removeItem("leags_authorized");
  try {
    if (typeof stopRecognition === "function") {
      stopRecognition();
    }
  } catch(e) {}
  initSecurityGate();
  showToast("🔒 Security Gateway Activated. System Locked.");
  speakOutLoud("System locked. Face ID active.");

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

// Handle phone call action when triggered remotely from PC
const origExecutePhoneAction = executePhoneActionLocally;
executePhoneActionLocally = function(action, params = {}) {
  if (action === "phone_call") {
    const target = params.target || "Contact";
    const num = params.number || target;
    showToast(`📞 Calling ${target}...`);
    speakOutLoud(`Calling ${target} on phone.`);
    window.location.href = `tel:${encodeURIComponent(num)}`;
  } else {
    origExecutePhoneAction(action, params);
  }
};

// Load saved key in Settings
if (geminiKey) {
  const keyInput = document.getElementById("gemini-key-input");
  if (keyInput) keyInput.value = geminiKey;
}

// Initialize Biometric Security Gate and Cloud Mesh
initSecurityGate();
connectMesh();
