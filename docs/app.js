const chatContainer = document.getElementById("chat-container");
const userInput = document.getElementById("user-input");
const btnSend = document.getElementById("btn-send");
const btnMic = document.getElementById("btn-mic");

const pcStatusDot = document.getElementById("pc-status-dot");
const pcStatusText = document.getElementById("pc-status-text");
const cpuBadge = document.getElementById("cpu-badge");
const ramBadge = document.getElementById("ram-badge");
const batBadge = document.getElementById("bat-badge");

// Poll PC Bridge Status
async function checkPCStatus() {
  try {
    const res = await fetch("/api/system/status");
    if (!res.ok) return;
    const data = await res.json();

    if (data.online) {
      pcStatusDot.className = "status-dot online";
      pcStatusText.textContent = "PC: Online";
      if (cpuBadge) cpuBadge.textContent = `CPU ${data.cpu_percent}%`;
      if (ramBadge) ramBadge.textContent = `RAM ${data.ram.percent}%`;
      if (batBadge && data.battery.percent !== null) {
        const icon = data.battery.power_plugged ? "⚡" : "🔋";
        batBadge.textContent = `${icon} ${data.battery.percent}%`;
      }
    } else {
      pcStatusDot.className = "status-dot";
      pcStatusText.textContent = "PC: Offline";
      if (cpuBadge) cpuBadge.textContent = "CPU --%";
      if (ramBadge) ramBadge.textContent = "RAM --%";
      if (batBadge) batBadge.textContent = "⚡ --%";
    }
  } catch (err) {
    pcStatusDot.className = "status-dot";
    pcStatusText.textContent = "PC: Offline";
  }
}
setInterval(checkPCStatus, 3000);
checkPCStatus();

// Quick Actions
async function sendAction(actionName, params = {}) {
  appendMessage("user", `Triggered: ${actionName.toUpperCase()}`);
  showTyping();
  try {
    const res = await fetch(`/api/action/${actionName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: actionName, params })
    });
    hideTyping();
    const data = await res.json();
    appendMessage("assistant", data.message || "Action executed.", data.status === "offline" ? "PC Offline" : "PC Command");
  } catch (err) {
    hideTyping();
    appendMessage("assistant", `Failed to send action: ${err.message}`);
  }
}

// Speech Recognition (Works seamlessly over HTTPS)
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

// Send Chat
async function sendChatMessage(overrideText) {
  const text = overrideText || userInput.value.trim();
  if (!text) return;

  userInput.value = "";
  appendMessage("user", text);
  showTyping();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });

    hideTyping();
    if (!res.ok) {
      appendMessage("assistant", "⚠️ Cloud server error.");
      return;
    }

    const data = await res.json();
    appendMessage("assistant", data.response, data.source === "pc" ? "Desktop Bridge" : "Gemini Cloud");

  } catch (err) {
    hideTyping();
    appendMessage("assistant", `⚠️ Connection error: ${err.message}`);
  }
}

btnSend.addEventListener("click", () => sendChatMessage());
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});
