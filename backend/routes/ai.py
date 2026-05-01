import json
import os
import re
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

from backend.models.document import (
    ClassificationResponse,
    ExtractedFields,
    SummaryResponse,
    TextRequest,
)

router = APIRouter(prefix="/api/ai", tags=["ai"])

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "llama-3.3-70b-versatile"
ALLOWED_TYPES = {
    "invoice", "receipt", "contract", "letter", "note",
    "report", "form", "id_document", "email", "other",
}


def _api_key() -> str:
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")
    return key


def _model() -> str:
    return os.getenv("GROQ_MODEL", DEFAULT_MODEL)


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).rstrip("` \n")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = _JSON_BLOCK_RE.search(text)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    raise ValueError("No valid JSON object found")


async def _post_groq(payload: dict[str, Any]) -> httpx.Response:
    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            return await client.post(GROQ_URL, json=payload, headers=headers)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Groq request failed: {e}")


async def _groq_chat(system: str, user: str, json_mode: bool = True) -> dict[str, Any]:
    base: dict[str, Any] = {
        "model": _model(),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
    }
    payload = dict(base)
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    r = await _post_groq(payload)

    # Groq sometimes rejects strict json_object mode when the model emits
    # malformed JSON (json_validate_failed). Fall back to plain text and
    # extract the JSON block ourselves.
    if r.status_code == 400 and json_mode and "json_validate_failed" in r.text:
        r = await _post_groq(base)

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Groq error {r.status_code}: {r.text}")

    data = r.json()
    content = data["choices"][0]["message"]["content"]
    if not json_mode:
        return {"raw": content}
    try:
        return _extract_json(content)
    except ValueError:
        raise HTTPException(status_code=502, detail="Groq returned invalid JSON")


@router.post("/classify", response_model=ClassificationResponse)
async def classify(req: TextRequest) -> ClassificationResponse:
    system = (
        "You classify business documents. Respond ONLY with JSON of the form "
        '{"document_type": <one of: invoice, receipt, contract, letter, note, '
        'report, form, id_document, email, other>, "confidence": <0..1 float>, '
        '"rationale": <short reason>}. No prose outside JSON.'
    )
    user = f"Classify this document text:\n\n{req.text[:6000]}"
    result = await _groq_chat(system, user, json_mode=True)

    doc_type = str(result.get("document_type", "other")).lower().strip()
    if doc_type not in ALLOWED_TYPES:
        doc_type = "other"
    try:
        confidence = float(result.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))
    rationale = str(result.get("rationale", "")).strip() or "No rationale provided."

    return ClassificationResponse(
        document_type=doc_type,  # type: ignore[arg-type]
        confidence=confidence,
        rationale=rationale,
    )


@router.post("/summarize", response_model=SummaryResponse)
async def summarize(req: TextRequest) -> SummaryResponse:
    system = (
        "You summarize documents. Respond ONLY with JSON of the form "
        '{"summary": <2-3 sentence summary>, "key_points": [<short bullet>, ...]}. '
        "Keep key_points to at most 5 items. No prose outside JSON."
    )
    user = f"Summarize this document text:\n\n{req.text[:6000]}"
    result = await _groq_chat(system, user, json_mode=True)

    summary = str(result.get("summary", "")).strip() or "No summary available."
    raw_points = result.get("key_points", []) or []
    if not isinstance(raw_points, list):
        raw_points = []
    key_points = [str(p).strip() for p in raw_points if str(p).strip()][:5]

    return SummaryResponse(summary=summary, key_points=key_points)


_AMOUNT_RE = re.compile(r"(?:[$€£¥₹]|USD|EUR|GBP)\s?\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?|\b\d+[.,]\d{2}\b")
_DATE_RE = re.compile(
    r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|"
    r"\d{4}-\d{2}-\d{2}|"
    r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_NAME_RE = re.compile(r"\b([A-Z][a-z]{1,20})\s+([A-Z][a-z]{1,20})\b")


@router.post("/extract", response_model=ExtractedFields)
async def extract_fields(req: TextRequest) -> ExtractedFields:
    text = req.text
    amounts = list(dict.fromkeys(_AMOUNT_RE.findall(text)))[:20]
    dates = list(dict.fromkeys(_DATE_RE.findall(text)))[:20]
    emails = list(dict.fromkeys(_EMAIL_RE.findall(text)))[:20]
    names_raw = _NAME_RE.findall(text)
    names = list(dict.fromkeys(f"{a} {b}" for a, b in names_raw))[:20]
    return ExtractedFields(amounts=amounts, dates=dates, names=names, emails=emails)
