from datetime import datetime, timezone
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, ConfigDict
import json

from backend.app.core.auth import decode_access_token_user_id, get_current_user

router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        user_connections = self.active_connections.setdefault(user_id, [])
        if websocket not in user_connections:
            user_connections.append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: int):
        user_connections = self.active_connections.get(user_id)
        if not user_connections:
            return
        if websocket in user_connections:
            user_connections.remove(websocket)
        if not user_connections:
            self.active_connections.pop(user_id, None)

    async def broadcast(self, user_id: int, message: str):
        disconnected: list[WebSocket] = []
        for connection in list(self.active_connections.get(user_id, [])):
            try:
                await connection.send_text(message)
            except Exception:
                disconnected.append(connection)
        for connection in disconnected:
            self.disconnect(connection, user_id)

manager = ConnectionManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    user_id = decode_access_token_user_id(websocket.query_params.get("token"))
    if user_id is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket, user_id)
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
        manager.disconnect(websocket, user_id)

class CaptureAsset(BaseModel):
    model_config = ConfigDict(extra='allow')

class DebugAssetPayload(BaseModel):
    asset: CaptureAsset

@router.post("/debug/assets")
async def broadcast_asset(
    payload: DebugAssetPayload,
    current_user: dict = Depends(get_current_user),
):
    event = {
        "event": "asset.created",
        "asset": payload.asset.model_dump(),
        "receivedAt": datetime.now(timezone.utc).isoformat(),
    }
    await manager.broadcast(int(current_user["id"]), json.dumps(event))
    return {"status": "ok"}
