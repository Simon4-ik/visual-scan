from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

DocumentType = Literal[
    "invoice", "receipt", "contract", "letter", "note",
    "report", "form", "id_document", "email", "other"
]


class TextRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Raw text extracted via OCR")


class ClassificationResponse(BaseModel):
    document_type: DocumentType
    confidence: float = Field(..., ge=0.0, le=1.0)
    rationale: str


class SummaryResponse(BaseModel):
    summary: str
    key_points: list[str] = Field(default_factory=list)


class ExtractedFields(BaseModel):
    amounts: list[str] = Field(default_factory=list)
    dates: list[str] = Field(default_factory=list)
    names: list[str] = Field(default_factory=list)
    emails: list[str] = Field(default_factory=list)


class ScanRecord(BaseModel):
    id: str
    filename: str
    scanned_at: datetime
    text: str
    classification: Optional[ClassificationResponse] = None
    summary: Optional[SummaryResponse] = None
    extracted_fields: Optional[ExtractedFields] = None


class ScanCreate(BaseModel):
    filename: str
    text: str
    classification: Optional[ClassificationResponse] = None
    summary: Optional[SummaryResponse] = None
    extracted_fields: Optional[ExtractedFields] = None


class OCRResponse(BaseModel):
    text: str
    char_count: int
