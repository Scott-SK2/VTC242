"""Un canal par utilisateur : groupes user.<id>, ride.<id> et backoffice (section 7.3)."""

from __future__ import annotations

import json
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .events import ADMIN_GROUP, user_group


class ClientConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4401)
            return
        self.user = user
        self.groups_joined = [user_group(user.id)]
        if user.is_staff_role:
            self.groups_joined.append(ADMIN_GROUP)
        for g in self.groups_joined:
            await self.channel_layer.group_add(g, self.channel_name)
        await self.accept()
        await self.send_frame("connected", {"user_id": str(user.id), "role": user.role})

    async def disconnect(self, code):
        for g in getattr(self, "groups_joined", []):
            await self.channel_layer.group_discard(g, self.channel_name)

    async def send_frame(self, event: str, data: dict):
        await self.send_json({"event": event, "ts": int(time.time() * 1000), "data": data})

    async def ws_send_frame(self, message):
        await self.send_json(
            {"event": message["event"], "ts": message["ts"], "data": message["data"]}
        )

    async def receive_json(self, content, **kwargs):
        event = content.get("event")
        data = content.get("data") or {}
        if event == "ping":
            await self.send_frame("pong", {})
        elif event == "driver.location":
            if self.user.role != "driver":
                return
            accepted = await self._record_positions([data])
            if not accepted:
                await self.send_frame("driver.location_rejected", {"reason": "accuracy"})
        elif event == "driver.location_batch":
            if self.user.role == "driver":
                await self._record_positions(data.get("positions") or [])
        elif event == "ride.offer_response":
            if self.user.role != "driver":
                return
            result = await self._offer_response(data.get("ride_id"), bool(data.get("accepted")))
            await self.send_frame("ride.offer_response_result", result)
        elif event == "chat.message":
            result = await self._chat(data.get("ride_id"), data.get("body"), data.get("preset"))
            if result:
                await self.send_frame("error", result)
        elif event == "subscribe_ride":
            await self.channel_layer.group_add(f"ride.{data.get('ride_id')}", self.channel_name)

    @database_sync_to_async
    def _record_positions(self, positions):
        from apps.drivers import services

        return services.record_positions(self.user.driver, positions)

    @database_sync_to_async
    def _offer_response(self, ride_id, accepted):
        from apps.common.exceptions import ApiError
        from apps.rides import services

        try:
            if accepted:
                services.accept(ride_id, self.user.driver)
            else:
                services.decline(ride_id, self.user.driver)
            return {"ride_id": ride_id, "accepted": accepted, "ok": True}
        except ApiError as exc:
            return {
                "ride_id": ride_id,
                "accepted": accepted,
                "ok": False,
                "code": exc.code,
                "message": exc.message,
            }

    @database_sync_to_async
    def _chat(self, ride_id, body, preset):
        from apps.common.exceptions import ApiError
        from apps.rides import services

        try:
            ride = services.get_ride_for(self.user, ride_id)
            services.send_message(ride, self.user, body, preset)
            return None
        except ApiError as exc:
            return {"code": exc.code, "message": exc.message}


def encode(data) -> str:
    return json.dumps(data, default=str)
