import os
from dataclasses import dataclass

@dataclass(frozen=True)
class Settings:
    max_file_bytes: int = int(os.getenv("CS_MAX_FILE_MB", "50")) * 1024 * 1024
    max_duration_s: float = float(os.getenv("CS_MAX_DURATION_S", "300"))
    max_samples: int = int(os.getenv("CS_MAX_SAMPLES", str(300 * 48000)))
    max_channels: int = 2
    ttl_seconds: int = int(os.getenv("CS_TTL_S", "3600"))
    max_items: int = 50
    cors_origins: tuple = tuple(os.getenv("CS_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(","))

settings = Settings()
