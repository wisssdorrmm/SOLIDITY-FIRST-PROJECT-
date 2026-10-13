import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidNafdacFormat, mergeFields, normalizeNafdac, parseMonthYear, parsePackText } from "./parse.ts";
import { runChecks } from "./checks.ts";

test("normalizes NAFDAC numbers", () => {
  assert.equal(normalizeNafdac("a4 – 1234"), "A4-1234");
  assert.equal(normalizeNafdac("NAFDAC REG. NO: 04-5678"), "04-5678");
  assert.ok(isValidNafdacFormat("A4-1234"));
  assert.ok(isValidNafdacFormat("04-12345"));
  assert.ok(!isValidNafdacFormat("1234"));
  assert.ok(!isValidNafdacFormat("ABC-12"));
});

test("parses month/year in common formats", () => {
  assert.deepEqual(parseMonthYear("05/2025"), { year: 2025, month: 5 });
  assert.deepEqual(parseMonthYear("05-25"), { year: 2025, month: 5 });
  assert.deepEqual(parseMonthYear("MAY 2025"), { year: 2025, month: 5 });
  assert.deepEqual(parseMonthYear("Sept.2026"), { year: 2026, month: 9 });
  assert.deepEqual(parseMonthYear("2027-11"), { year: 2027, month: 11 });
  assert.deepEqual(parseMonthYear("12/03/2026"), { year: 2026, month: 3 });
  assert.equal(parseMonthYear("13/2025"), undefined);
});

test("extracts fields from a typical pack", () => {
  const text = `ARTEMETHER/LUMEFANTRINE 80/480mg
  NAFDAC REG. NO: A4-0001
  BATCH NO.: KX12345
  MFD: 03/2025   EXP: 02/2028`;
  const f = parsePackText(text);
  assert.equal(f.nafdacNo, "A4-0001");
  assert.equal(f.batchNo, "KX12345");
  assert.deepEqual(f.mfd, { year: 2025, month: 3 });
  assert.deepEqual(f.exp, { year: 2028, month: 2 });
  assert.equal(f.hasNafdacLabel, true);
});

test("handles alternative labels", () => {
  const f = parsePackText("Nafdac No. 04-0003\nB/N: A12345\nMfg. Date: JAN 2024\nExpiry Date: DEC 2027");
  assert.equal(f.nafdacNo, "04-0003");
  assert.equal(f.batchNo, "A12345");
  assert.deepEqual(f.mfd, { year: 2024, month: 1 });
  assert.deepEqual(f.exp, { year: 2027, month: 12 });
});

test("ignores number-like text when there's no NAFDAC label", () => {
  assert.equal(parsePackText("Call 08-1234 for info").nafdacNo, undefined);
});

test("merges fields across frames", () => {
  const a = parsePackText("NAFDAC NO A4-0001");
  const b = parsePackText("BATCH NO KX12345 EXP 02/2028");
  const m = mergeFields(a, b);
  assert.equal(m.nafdacNo, "A4-0001");
  assert.equal(m.batchNo, "KX12345");
  assert.deepEqual(m.exp, { year: 2028, month: 2 });
});

const now = new Date(2026, 9, 13); // Oct 2026
const ref = {
  name: "Artemether/Lumefantrine 80/480mg",
  manufacturer: "Demo Pharma Ltd",
  keywords: ["ARTEMETHER", "LUMEFANTRINE"],
  batchPattern: "^[A-Z]{2}\\d{4,6}$",
  maxShelfLifeMonths: 36,
};

test("clean pack gets no red flags", () => {
  const text = "ARTEMETHER NAFDAC NO A4-0001 BATCH KX12345 MFD 03/2025 EXP 02/2028";
  const r = runChecks({ fields: parsePackText(text), ocrText: text, reference: ref, textMatches: [ref], now });
  assert.equal(r.verdict, "clear");
});

test("expired pack is high risk", () => {
  const text = "ARTEMETHER NAFDAC NO A4-0001 BATCH KX12345 MFD 03/2023 EXP 02/2026";
  const r = runChecks({ fields: parsePackText(text), ocrText: text, reference: ref, now });
  assert.equal(r.verdict, "high");
  assert.ok(r.findings.some((f) => f.title.startsWith("Expired")));
});

test("NAFDAC number borrowed from another product is high risk", () => {
  const text = "AMOXICILLIN 500mg NAFDAC NO A4-0001 BATCH KX12345 EXP 02/2028";
  const amox = { ...ref, name: "Amoxicillin 500mg", keywords: ["AMOXICILLIN"] };
  const r = runChecks({ fields: parsePackText(text), ocrText: text, reference: ref, textMatches: [amox], now });
  assert.equal(r.verdict, "high");
});

test("tampered dates are flagged", () => {
  const text = "NAFDAC NO A4-0001 BATCH KX12345 MFD 03/2027 EXP 02/2026";
  const r = runChecks({ fields: parsePackText(text), ocrText: text, now });
  assert.equal(r.verdict, "high");
  assert.ok(r.findings.some((f) => f.title.includes("future")));
  assert.ok(r.findings.some((f) => f.title.includes("before the manufacture")));
});

test("on-chain confirmed fake overrides an otherwise clean pack", () => {
  const text = "ARTEMETHER NAFDAC NO A4-0001 BATCH KX12345 MFD 03/2025 EXP 02/2028";
  const r = runChecks({
    fields: parsePackText(text),
    ocrText: text,
    reference: ref,
    chain: { risk: 2, pending: 0, confirmed: 1, rejected: 0 },
    now,
  });
  assert.equal(r.verdict, "high");
});

test("missing fields mean caution, not clear", () => {
  const r = runChecks({ fields: parsePackText("some blurry text"), ocrText: "some blurry text", now });
  assert.equal(r.verdict, "caution");
});

import { findDarkBands } from "./bands.ts";

test("finds dark banners but not a dark photo", () => {
  // Banner rows are mostly dark even where white letters cross them.
  const rows = [...Array(100).fill(0.6), ...Array(400).fill(0.05), ...Array(10).fill(0.9), ...Array(200).fill(0.05)];
  assert.deepEqual(findDarkBands(rows), [{ top: 0, bottom: 100 }]);
  assert.deepEqual(findDarkBands(Array(500).fill(0.95)), []);
});
