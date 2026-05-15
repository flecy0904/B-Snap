from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict
import json

router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        if websocket not in self.active_connections:
            self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        disconnected: list[WebSocket] = []
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception:
                disconnected.append(connection)
        for connection in disconnected:
            self.disconnect(connection)

manager = ConnectionManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
            except Exception:
                payload = {}
            if payload.get("event") == "ping":
                await websocket.send_text(json.dumps({
                    "event": "pong",
                    "receivedAt": datetime.now(timezone.utc).isoformat(),
                }))
    except WebSocketDisconnect:
        manager.disconnect(websocket)

class CaptureAsset(BaseModel):
    model_config = ConfigDict(extra='allow')

class DebugAssetPayload(BaseModel):
    asset: CaptureAsset

@router.post("/debug/assets")
async def broadcast_asset(payload: DebugAssetPayload):
    event = {
        "event": "asset.created",
        "asset": payload.asset.model_dump(),
        "receivedAt": datetime.now(timezone.utc).isoformat(),
    }
    await manager.broadcast(json.dumps(event))
    return {"status": "ok"}
