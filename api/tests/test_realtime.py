import pytest
from channels.testing import WebsocketCommunicator

from apps.accounts.authentication import issue_tokens
from apps.realtime import events
from config.asgi import application

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]


async def test_websocket_requires_token_and_delivers_user_events(passenger):
    headers = [(b"origin", b"http://localhost"), (b"host", b"localhost")]
    anon = WebsocketCommunicator(application, "/ws/", headers=headers)
    connected, code = await anon.connect()
    assert connected is False
    from asgiref.sync import sync_to_async

    token = (await sync_to_async(issue_tokens)(passenger))["access"]
    comm = WebsocketCommunicator(application, f"/ws/?token={token}", headers=headers)
    connected, _ = await comm.connect()
    assert connected
    hello = await comm.receive_json_from()
    assert hello["event"] == "connected" and hello["data"]["role"] == "passenger"
    await comm.send_json_to({"event": "ping"})
    pong = await comm.receive_json_from()
    assert pong["event"] == "pong"
    await sync_to_async(events.send_to_user)(passenger.id, "wallet.updated", {"balance": "1.00"})
    frame = await comm.receive_json_from()
    assert (
        frame["event"] == "wallet.updated" and frame["data"]["balance"] == "1.00" and "ts" in frame
    )
    await comm.disconnect()
