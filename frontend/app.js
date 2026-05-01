import {
  drawImageToCanvas,
  applyGrayscale,
  applyThreshold,
  rotateCanvas,
  cropCanvas,
  canvasToBlob,
  fileToImage,
} from "/static/utils/imageUtils.js";

const API = window.location.origin.startsWith("http")
  ? window.location.origin
  : "http://localhost:8000";

const state = {
  filename: null,
  originalImage: null,    // truly original (file or webcam snapshot) — Reset target
  baseSnapshot: null,     // ImageData after rotate/crop, before color filter
  cameraStream: null,
  classification: null,
  summary: null,
  extracted: null,
  scans: [],
  filter: "",
  sortKey: "scanned_at",
  sortDir: "desc",
};

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $("tab-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "results") loadScans();
  });
});

// ---------- Toast ----------
function toast(msg, type = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (type ? " " + type : "");
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3500);
}

// ---------- File / camera ----------
$("file-input").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  state.filename = file.name;
  try {
    state.originalImage = await fileToImage(file);
    drawImageToCanvas(canvas, state.originalImage);
    captureBaseSnapshot();
    enablePreprocessButtons(true);
    enableOcrButtons(true);
    resetAiResults();
  } catch (err) {
    toast(err.message || "Could not load image", "error");
  }
});

// Snapshot the canvas as a fresh "original" Image — needed for webcam captures
// so Reset can restore them.
async function snapshotCanvasAsOriginal() {
  const dataUrl = canvas.toDataURL("image/png");
  await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { state.originalImage = img; resolve(); };
    img.onerror = () => reject(new Error("Failed to snapshot canvas"));
    img.src = dataUrl;
  });
}

function captureBaseSnapshot() {
  const ctx = canvas.getContext("2d");
  state.baseSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function restoreBaseSnapshot() {
  if (!state.baseSnapshot) return false;
  canvas.width = state.baseSnapshot.width;
  canvas.height = state.baseSnapshot.height;
  canvas.getContext("2d").putImageData(state.baseSnapshot, 0, 0);
  return true;
}

$("btn-camera").addEventListener("click", async () => {
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    const video = $("video");
    video.srcObject = state.cameraStream;
    video.hidden = false;
    $("btn-stop-camera").hidden = false;
    $("btn-capture").hidden = false;
  } catch (err) {
    toast("Camera unavailable: " + (err.message || err), "error");
  }
});

$("btn-stop-camera").addEventListener("click", stopCamera);

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }
  $("video").hidden = true;
  $("btn-stop-camera").hidden = true;
  $("btn-capture").hidden = true;
}

$("btn-capture").addEventListener("click", async () => {
  const video = $("video");
  if (!video.videoWidth) return;
  drawImageToCanvas(canvas, video);
  state.filename = `webcam-${Date.now()}.png`;
  await snapshotCanvasAsOriginal();
  captureBaseSnapshot();
  enablePreprocessButtons(true);
  enableOcrButtons(true);
  resetAiResults();
  stopCamera();
});

// ---------- Preprocess ----------
// Rotate / crop modify geometry, so they update the base snapshot too.
$("btn-rotate-l").addEventListener("click", () => {
  rotateCanvas(canvas, "left");
  captureBaseSnapshot();
});
$("btn-rotate-r").addEventListener("click", () => {
  rotateCanvas(canvas, "right");
  captureBaseSnapshot();
});

// Color filters apply on top of the base — restoring first lets the user
// switch freely between grayscale and threshold (or back to color).
$("btn-grayscale").addEventListener("click", () => {
  if (!restoreBaseSnapshot()) return;
  applyGrayscale(canvas);
});
$("btn-threshold").addEventListener("click", () => {
  if (!restoreBaseSnapshot()) return;
  applyThreshold(canvas, 140);
});

$("btn-reset").addEventListener("click", () => {
  if (!state.originalImage) {
    toast("Nothing to reset to", "error");
    return;
  }
  drawImageToCanvas(canvas, state.originalImage);
  captureBaseSnapshot();
  toast("Reset to original");
});

function enablePreprocessButtons(enabled) {
  ["btn-rotate-l", "btn-rotate-r", "btn-grayscale", "btn-threshold", "btn-crop", "btn-reset"]
    .forEach((id) => ($(id).disabled = !enabled));
}

// ---------- Crop (drag-to-select) ----------
const cropOverlay = $("crop-overlay");
const cropRectEl = $("crop-rect");
const cropHint = $("crop-hint");
let cropMode = false;
let cropStart = null;

$("btn-crop").addEventListener("click", () => {
  cropMode = !cropMode;
  cropOverlay.classList.toggle("active", cropMode);
  $("btn-crop").classList.toggle("primary", cropMode);
  cropHint.hidden = !cropMode;
  cropRectEl.style.display = "none";
  cropStart = null;
});

cropOverlay.addEventListener("mousedown", (e) => {
  if (!cropMode) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  cropStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  Object.assign(cropRectEl.style, {
    left: `${cropStart.x}px`, top: `${cropStart.y}px`,
    width: "0px", height: "0px", display: "block",
  });
});

cropOverlay.addEventListener("mousemove", (e) => {
  if (!cropMode || !cropStart) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
  Object.assign(cropRectEl.style, {
    left: `${Math.min(cropStart.x, x)}px`,
    top: `${Math.min(cropStart.y, y)}px`,
    width: `${Math.abs(x - cropStart.x)}px`,
    height: `${Math.abs(y - cropStart.y)}px`,
  });
});

cropOverlay.addEventListener("mouseup", (e) => {
  if (!cropMode || !cropStart) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

  // Map CSS pixels back to canvas pixels.
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const sx = Math.min(cropStart.x, x) * scaleX;
  const sy = Math.min(cropStart.y, y) * scaleY;
  const sw = Math.abs(x - cropStart.x) * scaleX;
  const sh = Math.abs(y - cropStart.y) * scaleY;

  if (sw > 5 && sh > 5) {
    cropCanvas(canvas, sx, sy, sw, sh);
    captureBaseSnapshot();
    toast("Cropped", "success");
  }
  cropStart = null;
  cropRectEl.style.display = "none";
  cropMode = false;
  cropOverlay.classList.remove("active");
  $("btn-crop").classList.remove("primary");
  cropHint.hidden = true;
});

cropOverlay.addEventListener("mouseleave", () => {
  if (cropStart) {
    cropStart = null;
    cropRectEl.style.display = "none";
  }
});

function enableOcrButtons(enabled) {
  $("btn-ocr").disabled = !enabled;
  $("btn-ocr-server").disabled = !enabled;
}

// ---------- OCR (client-side, Tesseract.js) ----------
$("btn-ocr").addEventListener("click", async () => {
  if (!window.Tesseract) {
    toast("Tesseract.js not loaded", "error");
    return;
  }
  const progressBox = $("ocr-progress");
  const bar = $("ocr-progress-bar");
  const label = $("ocr-progress-label");
  progressBox.hidden = false;
  bar.style.width = "0%";
  label.textContent = "Initializing…";

  $("btn-ocr").disabled = true;
  try {
    const blob = await canvasToBlob(canvas, "image/png");
    const lang = $("lang-select")?.value || "eng";
    const { data } = await window.Tesseract.recognize(blob, lang, {
      logger: (m) => {
        if (m.status) label.textContent = `${m.status} (${lang})…`;
        if (typeof m.progress === "number") bar.style.width = `${Math.round(m.progress * 100)}%`;
      },
    });
    $("ocr-text").value = (data.text || "").trim();
    enableAiButtons(true);
    toast("Text extracted", "success");
  } catch (err) {
    toast("OCR failed: " + (err.message || err), "error");
  } finally {
    $("btn-ocr").disabled = false;
    setTimeout(() => (progressBox.hidden = true), 800);
  }
});

// ---------- OCR (server-side) ----------
$("btn-ocr-server").addEventListener("click", async () => {
  $("btn-ocr-server").disabled = true;
  try {
    const blob = await canvasToBlob(canvas, "image/png");
    const fd = new FormData();
    fd.append("file", blob, state.filename || "scan.png");
    const r = await fetch(`${API}/api/ocr/image`, { method: "POST", body: fd });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${r.status}`);
    }
    const data = await r.json();
    $("ocr-text").value = data.text || "";
    enableAiButtons(true);
    toast("Server OCR complete", "success");
  } catch (err) {
    toast("Server OCR failed: " + err.message, "error");
  } finally {
    $("btn-ocr-server").disabled = false;
  }
});

$("ocr-text").addEventListener("input", () => {
  enableAiButtons($("ocr-text").value.trim().length > 0);
});

function enableAiButtons(enabled) {
  ["btn-classify", "btn-summarize", "btn-extract", "btn-save"]
    .forEach((id) => ($(id).disabled = !enabled));
}

function resetAiResults() {
  state.classification = null;
  state.summary = null;
  state.extracted = null;
  ["classification-card", "summary-card", "extract-card"]
    .forEach((id) => ($(id).hidden = true));
}

// ---------- AI calls ----------
async function callAi(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${r.status}`);
  }
  return r.json();
}

$("btn-classify").addEventListener("click", async () => {
  const text = $("ocr-text").value.trim();
  if (!text) return;
  $("btn-classify").disabled = true;
  try {
    const data = await callAi("/api/ai/classify", { text });
    state.classification = data;
    $("cls-type").textContent = data.document_type;
    $("cls-confidence").textContent = `confidence: ${(data.confidence * 100).toFixed(0)}%`;
    $("cls-rationale").textContent = data.rationale;
    $("classification-card").hidden = false;
    toast("Classified", "success");
  } catch (err) {
    toast("Classify failed: " + err.message, "error");
  } finally {
    $("btn-classify").disabled = false;
  }
});

$("btn-summarize").addEventListener("click", async () => {
  const text = $("ocr-text").value.trim();
  if (!text) return;
  $("btn-summarize").disabled = true;
  try {
    const data = await callAi("/api/ai/summarize", { text });
    state.summary = data;
    $("sum-summary").textContent = data.summary;
    const ul = $("sum-keypoints");
    ul.innerHTML = "";
    (data.key_points || []).forEach((p) => {
      const li = document.createElement("li");
      li.textContent = p;
      ul.appendChild(li);
    });
    $("summary-card").hidden = false;
    toast("Summarized", "success");
  } catch (err) {
    toast("Summarize failed: " + err.message, "error");
  } finally {
    $("btn-summarize").disabled = false;
  }
});

$("btn-extract").addEventListener("click", async () => {
  const text = $("ocr-text").value.trim();
  if (!text) return;
  $("btn-extract").disabled = true;
  try {
    const data = await callAi("/api/ai/extract", { text });
    state.extracted = data;
    const dl = $("extract-fields");
    dl.innerHTML = "";
    const groups = [
      ["Amounts", data.amounts],
      ["Dates", data.dates],
      ["Names", data.names],
      ["Emails", data.emails],
    ];
    let any = false;
    for (const [label, items] of groups) {
      if (!items?.length) continue;
      any = true;
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = items.join(", ");
      dl.appendChild(dt); dl.appendChild(dd);
    }
    if (!any) dl.innerHTML = "<dt>—</dt><dd>No structured fields detected.</dd>";
    $("extract-card").hidden = false;
  } catch (err) {
    toast("Extract failed: " + err.message, "error");
  } finally {
    $("btn-extract").disabled = false;
  }
});

$("btn-save").addEventListener("click", async () => {
  const text = $("ocr-text").value.trim();
  if (!text) return;
  $("btn-save").disabled = true;
  try {
    const payload = {
      filename: state.filename || `scan-${Date.now()}.png`,
      text,
      classification: state.classification,
      summary: state.summary,
      extracted_fields: state.extracted,
    };
    const r = await fetch(`${API}/api/scans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    toast("Scan saved", "success");
  } catch (err) {
    toast("Save failed: " + err.message, "error");
  } finally {
    $("btn-save").disabled = false;
  }
});

// ---------- Results table ----------
async function loadScans() {
  try {
    const r = await fetch(`${API}/api/scans`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    state.scans = await r.json();
    renderScans();
  } catch (err) {
    toast("Load scans failed: " + err.message, "error");
  }
}

$("btn-refresh").addEventListener("click", loadScans);

$("filter-input").addEventListener("input", (e) => {
  state.filter = e.target.value.toLowerCase();
  renderScans();
});

document.querySelectorAll("#results-table th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDir = "asc";
    }
    renderScans();
  });
});

function renderScans() {
  const body = $("results-body");
  const filtered = state.scans.filter((s) => {
    if (!state.filter) return true;
    const f = state.filter;
    return (
      (s.filename || "").toLowerCase().includes(f) ||
      (s.text || "").toLowerCase().includes(f) ||
      (s.classification?.document_type || "").toLowerCase().includes(f)
    );
  });

  filtered.sort((a, b) => {
    const k = state.sortKey;
    const av = sortValue(a, k);
    const bv = sortValue(b, k);
    if (av < bv) return state.sortDir === "asc" ? -1 : 1;
    if (av > bv) return state.sortDir === "asc" ? 1 : -1;
    return 0;
  });

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No scans match.</td></tr>';
    return;
  }

  body.innerHTML = filtered
    .map(
      (s) => `
      <tr>
        <td>${escape(s.filename || "")}</td>
        <td>${escape(formatDate(s.scanned_at))}</td>
        <td><div class="snippet" title="${escape((s.text || "").slice(0, 200))}">${escape((s.text || "").slice(0, 80))}</div></td>
        <td>${s.classification ? `<span class="tag">${escape(s.classification.document_type)}</span>` : "—"}</td>
        <td><div class="snippet" title="${escape(s.summary?.summary || "")}">${escape((s.summary?.summary || "").slice(0, 80) || "—")}</div></td>
        <td><button class="btn-icon" data-id="${escape(s.id)}" title="Delete">✕</button></td>
      </tr>`,
    )
    .join("");

  body.querySelectorAll(".btn-icon").forEach((btn) => {
    btn.addEventListener("click", () => deleteScan(btn.dataset.id));
  });
}

function sortValue(s, k) {
  if (k === "classification") return s.classification?.document_type || "";
  if (k === "summary") return s.summary?.summary || "";
  return s[k] ?? "";
}

async function deleteScan(id) {
  if (!confirm("Delete this scan?")) return;
  try {
    const r = await fetch(`${API}/api/scans/${id}`, { method: "DELETE" });
    if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
    state.scans = state.scans.filter((s) => s.id !== id);
    renderScans();
    toast("Deleted", "success");
  } catch (err) {
    toast("Delete failed: " + err.message, "error");
  }
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Initial load
loadScans();
