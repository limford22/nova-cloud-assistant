import os
import json
import asyncio
from pathlib import Path
from typing import Dict, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

app = FastAPI(title="Nova Cloud Assistant", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Configuration from Environment Variables
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
SECRET_KEY = os.getenv("SECRET_KEY", "nova_secret_pairing_token_2026")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    gemini_model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        system_instruction=(
            "You are Nova, Linford's private personal AI companion. "
            "You run in the cloud 24/7 and coordinate with his Windows PC and Samsung Galaxy A52. "
            "Respond concisely, smartly, and conversationally."
        )
    )
else:
    gemini_model = None

# Active PC Worker WebSocket Connection & Cache
pc_socket: Optional[WebSocket] = None
latest_pc_status: Dict = {
    "online": False,
    "cpu_percent": 0,
    "ram": {"percent": 0, "used_gb": 0, "total_gb": 0},
    "disk_c": {"percent": 0, "free_gb": 0},
    "battery": {"percent": None, "power_plugged": None}
}
pending_pc_commands: Dict[str, asyncio.Future] = {}

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"

class ActionRequest(BaseModel):
    action: str
    params: dict = {}

@app.get("/")
def serve_index():
    return FileResponse(str(STATIC_DIR / "index.html"))

@app.get("/manifest.json")
def serve_manifest():
    return FileResponse(str(STATIC_DIR / "manifest.json"))

@app.get("/api/system/status")
def get_system_status():
    """Returns real-time PC telemetry reported from the PC worker."""
    return latest_pc_status

@app.websocket("/ws/pc")
async def pc_websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    """
    Dedicated bidirectional WebSocket for the lightweight PC worker.
    The PC connects here, authenticates, reports hardware stats, and receives commands.
    """
    global pc_socket, latest_pc_status
    if token != SECRET_KEY:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    pc_socket = websocket
    latest_pc_status["online"] = True
    print("[Cloud Bridge] Windows PC connected successfully.")

    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            # Handle incoming PC telemetry
            if payload.get("type") == "telemetry":
                latest_pc_status = payload.get("data", {})
                latest_pc_status["online"] = True
                
            # Handle command execution result
            elif payload.get("type") == "command_result":
                cmd_id = payload.get("command_id")
                if cmd_id in pending_pc_commands:
                    pending_pc_commands[cmd_id].set_result(payload.get("result"))
                    
    except WebSocketDisconnect:
        print("[Cloud Bridge] Windows PC disconnected.")
    finally:
        pc_socket = None
        latest_pc_status["online"] = False

async def send_command_to_pc(action: str, params: dict = {}, timeout: float = 5.0) -> dict:
    """Dispatches a desktop command down to the PC worker."""
    if not pc_socket:
        return {"status": "offline", "message": "Your Windows PC is currently offline."}
        
    cmd_id = f"cmd_{os.urandom(4).hex()}"
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    pending_pc_commands[cmd_id] = future
    
    try:
        await pc_socket.send_text(json.dumps({
            "command_id": cmd_id,
            "action": action,
            "params": params
        }))
        res = await asyncio.wait_for(future, timeout=timeout)
        return res
    except asyncio.TimeoutError:
        return {"status": "timeout", "message": "Command timed out waiting for PC response."}
    finally:
        pending_pc_commands.pop(cmd_id, None)

@app.post("/api/action/{action_name}")
async def quick_action_endpoint(action_name: str, req: ActionRequest = None):
    params = req.params if req else {}
    return await send_command_to_pc(action=action_name, params=params)

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    """
    Main Cloud Chat endpoint:
    - Identifies desktop actions (lock, mute, open app, battery) and forwards to PC
    - Passes open-ended conversation to Gemini Cloud AI (<0.3s)
    """
    msg = req.message.strip().lower()
    
    # 1. PC Command Matching
    if any(k in msg for k in ["lock pc", "lock screen", "lock computer", "lock workstation"]):
        pc_res = await send_command_to_pc("lock")
        return {"response": "🔒 " + pc_res.get("message", "Lock command sent."), "source": "pc"}
        
    if any(k in msg for k in ["mute", "unmute"]):
        pc_res = await send_command_to_pc("volume", {"action": "mute"})
        return {"response": "🔇 " + pc_res.get("message", "Volume toggled."), "source": "pc"}
        
    if "volume up" in msg:
        pc_res = await send_command_to_pc("volume", {"action": "up"})
        return {"response": "🔊 Volume increased.", "source": "pc"}
        
    if "volume down" in msg:
        pc_res = await send_command_to_pc("volume", {"action": "down"})
        return {"response": "🔉 Volume decreased.", "source": "pc"}
        
    if any(k in msg for k in ["pause", "resume", "play music", "pause music"]):
        pc_res = await send_command_to_pc("media", {"action": "play_pause"})
        return {"response": "⏯️ " + pc_res.get("message", "Media playback toggled."), "source": "pc"}

    if any(k in msg for k in ["pc status", "battery", "ram usage", "hardware"]):
        if latest_pc_status.get("online"):
            bat = latest_pc_status.get("battery", {})
            bat_str = f"{bat.get('percent')}% ({'plugged in' if bat.get('power_plugged') else 'battery'})" if bat.get("percent") is not None else "Desktop"
            reply = (
                f"💻 PC Status (Online):\n"
                f"• CPU: {latest_pc_status.get('cpu_percent')}%\n"
                f"• RAM: {latest_pc_status.get('ram', {}).get('percent')}%\n"
                f"• Battery: {bat_str}"
            )
            return {"response": reply, "source": "pc"}
        else:
            return {"response": "💻 Your Windows PC is currently offline.", "source": "pc"}

    # 2. General Cloud AI Reasoning (Gemini)
    if gemini_model:
        try:
            res = gemini_model.generate_content(req.message)
            return {"response": res.text.strip(), "source": "cloud"}
        except Exception as e:
            return {"response": f"AI service error: {str(e)}", "source": "error"}
    else:
        return {
            "response": f"Nova Cloud is online! (To enable general chat, configure GEMINI_API_KEY).",
            "source": "cloud"
        }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port)

