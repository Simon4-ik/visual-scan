import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from threading import Lock

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

from backend.models.document import ScanCreate, ScanRecord
from backend.routes import ai as ai_routes
from backend.routes import ocr as ocr_routes

ROOT = Path(__file__).resolve().parent.parent
SCANS_FILE = Path(__file__).resolve().parent / "logs" / "scans.json"
SCANS_FILE.parent.mkdir(parents=True, exist_ok=True)
if not SCANS_FILE.exists():
    SCANS_FILE.write_text("[]", encoding="utf-8")

_scans_lock = Lock()

app = FastAPI(
    title="Visual Scan API",
    description="Document scanner backend: OCR, classification, summarization.",
    version="1.0.0",
)

origins = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()
] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ai_routes.router)
app.include_router(ocr_routes.router)


def _read_scans() -> list[dict]:
    with _scans_lock:
        try:
            data = json.loads(SCANS_FILE.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except (FileNotFoundError, json.JSONDecodeError):
            return []


def _write_scans(scans: list[dict]) -> None:
    with _scans_lock:
        SCANS_FILE.write_text(json.dumps(scans, indent=2, default=str), encoding="utf-8")


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "groq_configured": bool(os.getenv("GROQ_API_KEY"))}


@app.get("/api/scans", response_model=list[ScanRecord])
async def list_scans() -> list[ScanRecord]:
    return [ScanRecord(**s) for s in _read_scans()]


@app.post("/api/scans", response_model=ScanRecord, status_code=201)
async def create_scan(payload: ScanCreate) -> ScanRecord:
    record = ScanRecord(
        id=uuid.uuid4().hex[:12],
        filename=payload.filename,
        scanned_at=datetime.utcnow(),
        text=payload.text,
        classification=payload.classification,
        summary=payload.summary,
        extracted_fields=payload.extracted_fields,
    )
    scans = _read_scans()
    scans.insert(0, json.loads(record.model_dump_json()))
    _write_scans(scans)
    return record


@app.delete("/api/scans/{scan_id}", status_code=204)
async def delete_scan(scan_id: str) -> None:
    scans = _read_scans()
    new_scans = [s for s in scans if s.get("id") != scan_id]
    if len(new_scans) == len(scans):
        raise HTTPException(status_code=404, detail="Scan not found")
    _write_scans(new_scans)


frontend_dir = ROOT / "frontend"
public_dir = ROOT / "public"

if public_dir.exists():
    app.mount("/public", StaticFiles(directory=public_dir), name="public")

if frontend_dir.exists():
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(frontend_dir / "index.html")
