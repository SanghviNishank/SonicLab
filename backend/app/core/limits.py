"""Concurrency gate for CPU/memory-heavy work.

Heavy endpoints each hold one slot while they run. Requests beyond CS_MAX_CONCURRENT wait up to CS_QUEUE_TIMEOUT_S for a free
slot and are then refused with HTTP 503 + Retry-After instead of piling up and exhausting memory/CPU.
This bounds CONCURRENCY. It cannot interrupt a computation that is already running (Python threads cannot be killed);
the running time of a single request is bounded instead by the input limits (duration, samples, file size).
"""
from __future__ import annotations
import functools
import threading
from fastapi import HTTPException
from app.core.config import settings

_sem = threading.BoundedSemaphore(max(1, settings.max_concurrent))


def _acquire() -> None:
    if not _sem.acquire(timeout=settings.queue_timeout_s):
        raise HTTPException(503, "The server is busy processing other recordings. Please retry in a few seconds.",
                            headers={"Retry-After": "5"})


def heavy_slot():
    """FastAPI dependency (generator): holds one processing slot for the duration of the request."""
    _acquire()
    try:
        yield
    finally:
        _sem.release()


def limited(fn):
    """Wrap a plain function so that it holds a processing slot while it runs (used for the threadpool-run upload decode)."""
    @functools.wraps(fn)
    def inner(*a, **k):
        _acquire()
        try:
            return fn(*a, **k)
        finally:
            _sem.release()
    return inner
