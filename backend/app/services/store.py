"""In-memory store with TTL (no database). Limits: single process, lost on restart."""
import threading, time, uuid
from app.core.config import settings

_lock = threading.Lock()
_items: dict[str, dict] = {}

def new_id() -> str:
    return uuid.uuid4().hex

def put(kind: str, payload: dict, item_id: str | None = None) -> str:
    with _lock:
        _purge()
        if len(_items) >= settings.max_items:
            oldest = min(_items, key=lambda k: _items[k]["t"]); del _items[oldest]
        item_id = item_id or new_id()
        _items[item_id] = {"kind": kind, "t": time.time(), "data": payload}
        return item_id

def get(item_id: str, kind: str) -> dict | None:
    with _lock:
        _purge()
        it = _items.get(item_id)
        return it["data"] if it and it["kind"] == kind else None

def _purge():
    now = time.time()
    for k in [k for k, v in _items.items() if now - v["t"] > settings.ttl_seconds]:
        del _items[k]
