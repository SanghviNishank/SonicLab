from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.core.config import settings

app = FastAPI(title="ClearVoice + RoadSonic API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"],
                   expose_headers=["X-Clip-Start-S", "X-Clip-End-S", "X-Event-Start-S", "X-Event-End-S", "X-Peak-Guard-Gain-Db", "Content-Disposition"])
app.include_router(router)
