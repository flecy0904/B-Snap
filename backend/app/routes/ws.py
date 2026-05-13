from typing import Dict
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict
import json

router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                pass

manager = ConnectionManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # We don't expect messages from the client right now, but we keep the connection open
            data = await websocket.receive_text()
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
    }
    await manager.broadcast(json.dumps(event))
    return {"status": "ok"}
