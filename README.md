# Visual Scan — Document Scanner

Full-stack document scanner with **Vanilla JavaScript** frontend and **FastAPI** backend.
Upload or photograph a document → preprocess on a Canvas → extract text via OCR
(Tesseract.js client-side or pytesseract server-side) → classify & summarize via
**Groq** LLM → save to a lightweight JSON store and review in a sortable, filterable
results table.

## Features

- Upload an image or capture from webcam
- Canvas preview with **rotate (90° L/R), grayscale, threshold, drag-to-crop, reset**
- **Multilingual** client-side OCR with Tesseract.js (English, Russian, Spanish,
  French, German, Italian, Portuguese, Chinese, Japanese, Arabic, plus combos)
- **Server-side OCR** (bonus) with `pytesseract`
- AI **classification** into 10 document types and **summarization** with key points
- **Structured field extraction** (bonus) — amounts, dates, names, emails
- Persisted scan history in `backend/logs/scans.json`
- Sortable, filterable results table; delete entries

## Project structure

```
visual-scan/
├── frontend/
│   ├── index.html          # Two-tab UI: Scan / Results
│   ├── styles.css          # Card layout, highlighted AI sections
│   ├── app.js              # Tesseract.js, API calls, table
│   └── utils/
│       └── imageUtils.js   # Canvas grayscale / threshold / rotate
├── backend/
│   ├── main.py             # FastAPI app, CORS, scan storage endpoints
│   ├── routes/
│   │   ├── ai.py           # /classify, /summarize, /extract (Groq)
│   │   └── ocr.py          # /image (server-side OCR)
│   ├── models/
│   │   └── document.py     # Pydantic models
│   └── logs/
│       └── scans.json      # Persisted scan history
├── public/
│   └── sample-docs/        # Sample images for demos
├── requirements.txt
├── .env.example            # Copy to .env and set GROQ_API_KEY
└── README.md
```

## Setup

### Prerequisites
- Python 3.10+
- (Optional) [Tesseract OCR binary](https://github.com/UB-Mannheim/tesseract/wiki) for server-side OCR
- A [Groq](https://console.groq.com/) API key

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env and set GROQ_API_KEY=...
```

### 2. Install Python dependencies

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### 3. Run the app

From the project root:

```bash
uvicorn backend.main:app --reload --port 8000
```

Open <http://localhost:8000> — the FastAPI app serves the frontend at `/`
and the API under `/api/...`. Interactive API docs are at `/docs`.

> Frontend can also be served separately (e.g., VS Code Live Server on `:5500`).
> CORS origins are read from `ALLOWED_ORIGINS` in `.env`.

## API documentation

All endpoints return JSON. Pydantic schemas live in `backend/models/document.py`.

### `GET /api/health`
Health check.
```json
{ "status": "ok", "groq_configured": true }
```

### `POST /api/ai/classify`
**Request**
```json
{ "text": "INVOICE\nBill to: Acme Inc.\nTotal: $1,234.56" }
```
**Response**
```json
{
  "document_type": "invoice",
  "confidence": 0.92,
  "rationale": "Mentions 'INVOICE', billing party, and a total amount."
}
```
`document_type` is one of: `invoice`, `receipt`, `contract`, `letter`, `note`,
`report`, `form`, `id_document`, `email`, `other`.

### `POST /api/ai/summarize`
**Request**
```json
{ "text": "Long document text..." }
```
**Response**
```json
{
  "summary": "Two- to three-sentence summary.",
  "key_points": ["point 1", "point 2", "point 3"]
}
```

### `POST /api/ai/extract`
Regex-based field extraction (no LLM call).
**Request**
```json
{ "text": "Invoice 2024-03-15 — total $1,234.56 — contact a@b.com" }
```
**Response**
```json
{
  "amounts": ["$1,234.56"],
  "dates": ["2024-03-15"],
  "names": [],
  "emails": ["a@b.com"]
}
```

### `POST /api/ocr/image`
Multipart form upload (`file=<image>`). Server-side OCR via pytesseract.
**Response**
```json
{ "text": "Extracted text...", "char_count": 123 }
```
Returns `503` if the Tesseract binary is not installed on the server.

### `GET /api/scans`
Returns array of `ScanRecord`:
```json
[
  {
    "id": "a1b2c3d4e5f6",
    "filename": "invoice.png",
    "scanned_at": "2026-04-30T12:34:56",
    "text": "...",
    "classification": { "document_type": "invoice", "confidence": 0.9, "rationale": "..." },
    "summary": { "summary": "...", "key_points": ["..."] },
    "extracted_fields": { "amounts": ["..."], "dates": ["..."], "names": [], "emails": [] }
  }
]
```

### `POST /api/scans`
Saves a scan. Body matches `ScanCreate` (omit `id`/`scanned_at` — the server
assigns them). Returns the created `ScanRecord` with status `201`.

### `DELETE /api/scans/{scan_id}`
Removes a scan. Returns `204` on success, `404` if not found.

## Usage

1. **Upload & Scan tab**
   1. Click **Upload image** (or **Use webcam** → **Capture**).
   2. Optionally rotate / grayscale / threshold / **crop** the image on the canvas.
      For crop: click **✂ Crop**, then drag a rectangle on the image — release to apply.
   3. Pick a **Language** from the dropdown, then click **Extract text (client-side)**
      to run Tesseract.js, or **Extract text (server-side)** to run pytesseract.
   4. Edit the extracted text if needed.
   5. Click **Classify**, **Summarize**, **Extract fields** — results render in
      highlighted cards.
   6. Click **Save scan** to persist.

2. **Scanned Results tab**
   - Click any column header to sort.
   - Type in the filter box to narrow rows.
   - Click ✕ to delete a scan.

## Bonus features implemented

- ✅ Server-side OCR via `pytesseract` (`POST /api/ocr/image`)
- ✅ JSON-file scan storage (`backend/logs/scans.json`)
- ✅ Structured field extraction — amounts, dates, names, emails (`POST /api/ai/extract`)
- ✅ Drag-to-crop tool on the canvas
- ✅ Multilingual OCR (12 language presets, including combos like `eng+rus`)

## Notes

- The Groq API key is loaded from `.env` (server-side only). Never commit `.env`.
- Server-side OCR requires the **Tesseract binary** in addition to `pytesseract`.
  Client-side OCR works with no extra setup.
- `scans.json` is gitignored to avoid committing user data.
