// Canvas-based image preprocessing helpers.

export function drawImageToCanvas(canvas, source) {
  const ctx = canvas.getContext("2d");
  const w = source.naturalWidth || source.videoWidth || source.width;
  const h = source.naturalHeight || source.videoHeight || source.height;
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(source, 0, 0, w, h);
}

export function applyGrayscale(canvas) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

export function applyThreshold(canvas, threshold = 128) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const bw = v >= threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = bw;
  }
  ctx.putImageData(img, 0, 0);
}

// Rotate canvas by 90deg increments. direction = "left" | "right".
export function rotateCanvas(canvas, direction = "right") {
  const tmp = document.createElement("canvas");
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  tmp.getContext("2d").drawImage(canvas, 0, 0);

  const ctx = canvas.getContext("2d");
  const oldW = canvas.width;
  const oldH = canvas.height;
  canvas.width = oldH;
  canvas.height = oldW;

  ctx.save();
  if (direction === "right") {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}

// Crop the canvas in-place to a rectangle in canvas-pixel coordinates.
export function cropCanvas(canvas, sx, sy, sw, sh) {
  sx = Math.max(0, Math.round(sx));
  sy = Math.max(0, Math.round(sy));
  sw = Math.round(Math.min(sw, canvas.width - sx));
  sh = Math.round(Math.min(sh, canvas.height - sy));
  if (sw <= 0 || sh <= 0) return;

  const tmp = document.createElement("canvas");
  tmp.width = sw;
  tmp.height = sh;
  tmp.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d").drawImage(tmp, 0, 0);
}

export function canvasToBlob(canvas, type = "image/png", quality = 0.92) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to decode image"));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
