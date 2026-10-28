"""In-memory store with TTL and a MEMORY BUDGET (no database). Limits: single process, lost on restart.

Eviction: items older than CS_TTL_S are dropped; if the unique buffers held by all items exceed CS_MAX_STORE_MB (or there are more
than max_items items) the least-recently-used items are evicted first. The item being inserted is never evicted by its own insertion,
so a single recording larger than the budget is still accepted (and everything else is evicted).
Accounting counts every distinct numpy array / bytes object once, even if several items reference it (jobs share the uploaded samples).
"""
import logging, threading, time, uuid
import numpy as np
from app.core.config import settings

logger = logging.getLogger("signalsystem.store")
_lock = threading.Lock()
_items: dict[str, dict] = {}


def new_id() -> str:
    return uuid.uuid4().hex


def _walk(obj, seen: set, depth: int = 0) -> int:
    """Bytes held by distinct arrays / bytes objects reachable from obj (containers are followed to a small depth)."""
    if depth > 6:
        return 0
    if isinstance(obj, np.ndarray):
        base = obj.base if isinstance(obj.base, np.ndarray) else obj           # views share the base buffer
        if id(base) in seen:
            return 0
        seen.add(id(base)); return int(base.nbytes)
    if isinstance(obj, (bytes, bytearray)):
        if id(obj) in seen:
            return 0
        seen.add(id(obj)); return len(obj)
    if isinstance(obj, dict):
        return sum(_walk(v, seen, depth + 1) for v in obj.values())
    if isinstance(obj, (list, tuple)):
        return sum(_walk(v, seen, depth + 1) for v in obj)
    return 0


def total_bytes() -> int:
    seen: set = set()
    return sum(_walk(v["data"], seen) for v in _items.values())


def stats() -> dict:
    with _lock:
        return {"items": len(_items), "bytes": total_bytes(), "budget_bytes": settings.max_store_bytes}


def _purge():
    now = time.time()
    for k in [k for k, v in _items.items() if now - v["t"] > settings.ttl_seconds]:
        del _items[k]


def _evict(keep: str):
    while len(_items) > settings.max_items or (total_bytes() > settings.max_store_bytes and len(_items) > 1):
        victims = [k for k in _items if k != keep]
        if not victims:
            return
        oldest = min(victims, key=lambda k: _items[k]["last"])
        logger.info("store evicting %s item (least recently used) to stay within the memory budget", _items[oldest]["kind"])
        del _items[oldest]


def put(kind: str, payload: dict, item_id: str | None = None) -> str:
    with _lock:
        _purge()
        item_id = item_id or new_id()
        now = time.time()
        _items[item_id] = {"kind": kind, "t": now, "last": time.perf_counter(), "data": payload}
        _evict(keep=item_id)
        return item_id


def get(item_id: str, kind: str) -> dict | None:
    with _lock:
        _purge()
        it = _items.get(item_id)
        if it and it["kind"] == kind:
            it["last"] = time.perf_counter()
            return it["data"]
        return None


def delete(item_id: str) -> None:
    with _lock:
        _items.pop(item_id, None)


def list_summaries() -> list[dict]:
    """Metadata only (never audio arrays)."""
    with _lock:
        _purge()
        out = []
        for k, v in sorted(_items.items(), key=lambda kv: kv[1]["t"], reverse=True):
            if v["kind"] != "job": continue
            d = v["data"]
            out.append({"job_id": k, "created_epoch": v["t"], "input_label": d.get("name"),
                        "type": "roadsonic" if "events" in d else "clearvoice",
                        "config": d.get("config"), "warnings": d.get("warnings", []),
                        "events": len(d["events"]) if "events" in d else None})
        return out
