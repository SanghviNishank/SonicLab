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
    # Total memory the in-memory store may hold (unique array/bytes buffers). Oldest-unused items are evicted beyond this.
    max_store_bytes: int = int(float(os.getenv("CS_MAX_STORE_MB", "1024")) * 1024 * 1024)
    # Heavy requests (decode, analysis, filtering, detection, reports) running at the same time; extra ones wait, then get HTTP 503.
    max_concurrent: int = int(os.getenv("CS_MAX_CONCURRENT", "2"))
    queue_timeout_s: float = float(os.getenv("CS_QUEUE_TIMEOUT_S", "30"))
    max_json_body_bytes: int = 1024 * 1024
    upload_overhead_bytes: int = 1024 * 1024        # multipart framing allowance on top of max_file_bytes
    cors_origins: tuple = tuple(os.getenv("CS_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(","))

settings = Settings()
