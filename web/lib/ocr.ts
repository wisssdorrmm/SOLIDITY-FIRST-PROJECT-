// Browser-side OCR. Runs on the phone, so nothing leaves the device unless the user reports.

import type { Worker } from "tesseract.js";
import { findDarkBands } from "./bands.ts";

let workerPromise: Promise<Worker> | undefined;

export function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract",
        langPath: "/tesseract",
        gzip: true,
      });
      // Packs have scattered text blocks, not paragraphs.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      return worker;
    })().catch((err) => {
      workerPromise = undefined;
      throw err;
    });
  }
  return workerPromise;
}

/** Draws a video frame or image onto a canvas, scaled down, for OCR and for the evidence photo. */
export function captureToCanvas(source: HTMLVideoElement | HTMLImageElement, maxSide = 1600): HTMLCanvasElement {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Greyscale + contrast stretch: helps OCR on glossy, colourful cartons. */
export function preprocessForOcr(src: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) * 255) / range;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Fraction of dark pixels in each row of a greyscale canvas. */
function rowDarkShare(canvas: HTMLCanvasElement): Float32Array {
  const { width, height } = canvas;
  const d = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  const share = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) if (d[(y * width + x) * 4] < 128) dark++;
    share[y] = dark / width;
  }
  return share;
}

function crop(src: HTMLCanvasElement, top: number, bottom: number): HTMLCanvasElement {
  const pad = 6;
  const y0 = Math.max(0, top - pad);
  const h = Math.min(src.height, bottom + pad) - y0;
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(src, 0, y0, src.width, h, 0, 0, src.width, h);
  return canvas;
}

export async function recognize(canvas: HTMLCanvasElement): Promise<string> {
  const worker = await getOcrWorker();
  const prepared = preprocessForOcr(canvas);
  const { data } = await worker.recognize(prepared);
  const texts = [data.text];
  // Light text on dark banners (often the product name) needs its own pass.
  for (const band of findDarkBands(rowDarkShare(prepared))) {
    const { data: bandData } = await worker.recognize(crop(prepared, band.top, band.bottom));
    if (bandData.text.trim()) texts.push(bandData.text);
  }
  return texts.join("\n");
}

/** SHA-256 of the photo bytes: the on-chain fingerprint of the evidence. */
export async function sha256Hex(dataUrl: string): Promise<`0x${string}`> {
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `0x${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
