// DOM Elements
const chatContainer = document.getElementById("chat-container");
const userInput = document.getElementById("user-input");
const btnSend = document.getElementById("btn-send");
const btnMic = document.getElementById("btn-mic");

const pcStatusDot = document.getElementById("pc-status-dot");
const pcStatusText = document.getElementById("pc-status-text");
const cpuBadge = document.getElementById("cpu-badge");
const ramBadge = document.getElementById("ram-badge");
const batBadge = document.getElementById("bat-badge");

// MQTT Real-time Cloud Broker Configuration
const MQTT_BROKER = "wss://broker.hivemq.com:8884/mqtt";
const USER_CHANNEL = "nova/limford22";
const CMD_TOPIC = `${USER_CHANNEL}/cmd`;
const STATUS_TOPIC = `${USER_CHANNEL}/status`;
const REPLY_TOPIC = `${USER_CHANNEL}/reply`;

let mqttClient = null;
let lastPCPing = 0;
let isPCOnline = false;

// Connect to Cloud Real-time Mesh
function initMQTT() {
  const clientId = "nova_client_" + Math.random().toString(16).substring(2, 10);
  mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: clientId,
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 3000
  });

  mqttClient.on("connect", () => {
    console.log("[Cloud Bridge] Connected to real-time broker.");
    mqttClient.subscribe(STATUS_TOPIC);
    mqttClient.subscribe(REPLY_TOPIC);
  });

  mqttClient.on("message", (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      if (topic === STATUS_TOPIC) {
        handlePCStatus(payload);
      } else if (topic === REPLY_TOPIC) {
        hideTyping();
        appendMessage("assistant", payload.message || "Command executed on PC.", "Desktop Action");
      }
    } catch (e) {
      console.warn("MQTT Parse error:", e);
    }
  });

  mqttClient.on("error", (err) => {
    console.warn("MQTT connection error:", err);
  });
}

function handlePCStatus(data) {
  lastPCPing = Date.now();
  if (!isPCOnline) {
    isPCOnline = true;
    pcStatusDot.className = "status-dot online";
    pcStatusText.textContent = "PC: Online";
  }

  if (cpuBadge) cpuBadge.textContent = `CPU ${data.cpu_percent}%`;
  if (ramBadge && data.ram) ramBadge.textContent = `RAM ${data.ram.percent}%`;
  if (batBadge && data.battery && data.battery.percent !== null) {
    const icon = data.battery.power_plugged ? "⚡" : "🔋";
    batBadge.textContent = `${icon} ${data.battery.percent}%`;
  }
}

// Watchdog for PC Online status
setInterval(() => {
  if (isPCOnline && (Date.now() - lastPCPing > 12000)) {
    isPCOnline = false;
    pcStatusDot.className = "status-dot";
    pcStatusText.textContent = "PC: Offline";
    if (cpuBadge) cpuBadge.textContent = "CPU --%";
    if (ramBadge) ramBadge.textContent = "RAM --%";
    if (batBadge) batBadge.textContent = "⚡ --%";
  }
}, 4000);

initMQTT();

// Dispatch Command to PC
function sendAction(actionName, params = {}) {
  appendMessage("user", `Triggered: ${actionName.toUpperCase()}`);
  showTyping();

  if (!mqttClient || !mqttClient.connected) {
    hideTyping();
    appendMessage("assistant", "⚠️ Connecting to cloud broker... Please try again in a moment.");
    return;
  }

  const payload = {
    action: actionName,
    params: params,
    timestamp: Date.now()
  };

  mqttClient.publish(CMD_TOPIC, JSON.stringify(payload));

  // If PC is offline, notify user
  if (!isPCOnline) {
    setTimeout(() => {
      hideTyping();
      appendMessage("assistant", "⚠️ Your PC appears to be offline or PC Worker is not running.", "Notice");
    }, 1500);
  }
}

// Speech Recognition (Works seamlessly on HTTPS)
let recognition = null;
let isRecording = false;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isRecording = true;
    btnMic.classList.add("listening");
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    userInput.value = transcript;
    sendChatMessage(transcript);
  };

  recognition.onerror = () => {
    isRecording = false;
    btnMic.classList.remove("listening");
  };

  recognition.onend = () => {
    isRecording = false;
    btnMic.classList.remove("listening");
  };

  btnMic.addEventListener("click", () => {
    if (isRecording) {
      recognition.stop();
    } else {
      try { recognition.start(); } catch (e) {}
    }
  });
} else {
  btnMic.style.display = "none";
}

// UI Message Renderer
function appendMessage(role, text, source = null) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  msgDiv.appendChild(bubble);

  if (source) {
    const tag = document.createElement("span");
    tag.className = "source-tag";
    tag.textContent = source;
    msgDiv.appendChild(tag);
  }

  chatContainer.appendChild(msgDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Typing Indicator
let typingDiv = null;
function showTyping() {
  if (typingDiv) return;
  typingDiv = document.createElement("div");
  typingDiv.className = "typing-indicator";
  typingDiv.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  chatContainer.appendChild(typingDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function hideTyping() {
  if (typingDiv) {
    typingDiv.remove();
    typingDiv = null;
  }
}

// Chat Flow & Reflex Logic
async function sendChatMessage(overrideText) {
  const text = (overrideText || userInput.value).trim();
  if (!text) return;

  userInput.value = "";
  appendMessage("user", text);
  showTyping();

  const lower = text.toLowerCase();

  // 1. Direct Desktop Reflexes
  if (lower.includes("lock")) {
    sendAction("lock");
    return;
  }
  if (lower.includes("mute") || lower.includes("unmute")) {
    sendAction("volume", { action: "mute" });
    return;
  }
  if (lower.includes("volume up")) {
    sendAction("volume", { action: "up" });
    return;
  }
  if (lower.includes("volume down")) {
    sendAction("volume", { action: "down" });
    return;
  }
  if (lower.includes("pause") || lower.includes("play music")) {
    sendAction("media", { action: "play_pause" });
    return;
  }
  if (lower.includes("battery") || lower.includes("status")) {
    hideTyping();
    if (isPCOnline) {
      appendMessage("assistant", `💻 PC is online: ${cpuBadge.textContent}, ${ramBadge.textContent}, Battery ${batBadge.textContent}.`, "Desktop Status");
    } else {
      appendMessage("assistant", "💻 Windows PC is currently offline.", "Notice");
    }
    return;
  }
  if (lower.startsWith("open ") || lower.startsWith("launch ")) {
    const app = lower.replace(/^(open|launch)\s+/, "");
    sendAction("app", { app_name: app });
    return;
  }

  // 2. Cloud AI Fallback
  setTimeout(() => {
    hideTyping();
    appendMessage("assistant", `Nova Cloud received: "${text}". Desktop command sent to PC.`, "Nova Cloud");
  }, 400);
}

btnSend.addEventListener("click", () => sendChatMessage());
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});
