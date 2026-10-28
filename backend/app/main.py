import logging, uuid
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.api.routes import router
from app.core.config import settings

logger = logging.getLogger("signalsystem.api")
app = FastAPI(title="ClearVoice + RoadSonic API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"],
                   expose_headers=["X-Clip-Start-S", "X-Clip-End-S", "X-Event-Start-S", "X-Event-End-S", "X-Peak-Guard-Gain-Db", "Content-Disposition", "Retry-After"])


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    """Reject oversized requests from the Content-Length header BEFORE the body is read (multipart bodies are spooled to disk by the parser)."""
    cl = request.headers.get("content-length")
    if cl is not None:
        try:
            n = int(cl)
        except ValueError:
            return JSONResponse({"detail": "invalid Content-Length header"}, status_code=400)
        is_upload = request.url.path.endswith("/audio/upload")
        cap = settings.max_file_bytes + settings.upload_overhead_bytes if is_upload else settings.max_json_body_bytes
        if n > cap:
            return JSONResponse({"detail": f"request body too large ({n} bytes; limit {cap} bytes)"}, status_code=413)
    return await call_next(request)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    """Never return stack traces or internal paths; log them (with an id the user can quote) instead."""
    err = uuid.uuid4().hex[:8]
    logger.error("Unhandled error %s on %s %s", err, request.method, request.url.path, exc_info=exc)
    return JSONResponse({"detail": f"Internal server error (error id {err}). See the server log."}, status_code=500)


app.include_router(router)
