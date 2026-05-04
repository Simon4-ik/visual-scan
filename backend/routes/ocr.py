import io
import os
import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.models.document import OCRResponse

router = APIRouter(prefix="/api/ocr", tags=["ocr"])

# Common Windows install paths used when the binary is not on PATH.
_WINDOWS_GUESSES = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
)


def _resolve_tesseract_cmd() -> Optional[str]:
    explicit = os.getenv("TESSERACT_CMD")
    if explicit and Path(explicit).exists():
        return explicit
    on_path = shutil.which("tesseract")
    if on_path:
        return on_path
    for guess in _WINDOWS_GUESSES:
        if Path(guess).exists():
            return guess
    return None


@router.post("/image", response_model=OCRResponse)
async def ocr_image(file: UploadFile = File(...)) -> OCRResponse:
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Server-side OCR unavailable: install pytesseract and Tesseract binary.",
        )

    cmd = _resolve_tesseract_cmd()
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 10MB)")

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot read image: {e}")

    if img.mode != "L":
        img = img.convert("L")

    try:
        text = pytesseract.image_to_string(img)
    except pytesseract.TesseractNotFoundError:
        raise HTTPException(
            status_code=503,
            detail=(
                "Tesseract binary not found on server. "
                "Install Tesseract OCR (https://github.com/UB-Mannheim/tesseract/wiki on Windows), "
                "then restart the backend. If installed in a custom location, set "
                "TESSERACT_CMD=<full path to tesseract.exe> in your .env file. "
                "Or use client-side OCR (Tesseract.js) instead."
            ),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR failed: {e}")

    text = text.strip()
    return OCRResponse(text=text, char_count=len(text))
