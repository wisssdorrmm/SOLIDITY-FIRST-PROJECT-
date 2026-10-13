// Copies the OCR engine and English model into public/ so the scanner works
// without third-party CDNs (they are often slow or blocked on Nigerian networks).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "public", "tesseract");
fs.mkdirSync(out, { recursive: true });

const copy = (from, name = path.basename(from)) => fs.copyFileSync(from, path.join(out, name));

copy(path.join(root, "node_modules/tesseract.js/dist/worker.min.js"));
const core = path.join(root, "node_modules/tesseract.js-core");
for (const f of fs.readdirSync(core)) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(f)) copy(path.join(core, f));
}
copy(path.join(root, "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"));
console.log(`OCR assets copied to ${path.relative(root, out)}`);
