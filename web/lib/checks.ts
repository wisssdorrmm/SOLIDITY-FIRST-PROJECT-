// Turns what we read off the pack into findings and an overall verdict.
// The app never declares a pack genuine: the best outcome is "no red flags found".

import { formatMonthYear, isValidNafdacFormat, type MonthYear, type PackFields } from "./parse.ts";

export type Severity = "red" | "amber" | "info";
export type Finding = { severity: Severity; title: string; detail?: string };
export type Verdict = "high" | "caution" | "clear";

export type ReferenceInfo = {
  name: string;
  manufacturer: string;
  keywords: string[];
  batchPattern?: string;
  maxShelfLifeMonths?: number;
  demo?: boolean;
};

export type ChainInfo = {
  risk: 0 | 1 | 2; // None, Suspected, ConfirmedFake (matches the contract enum)
  pending: number;
  confirmed: number;
  rejected: number;
};

export type AiFinding = { severity: Severity; message: string };
export type AiInfo = {
  assessment: "no_visible_issues" | "suspicious" | "likely_fake" | "unreadable";
  findings: AiFinding[];
};

export type CheckInput = {
  fields: PackFields;
  ocrText: string;
  reference?: ReferenceInfo; // product registered under the scanned NAFDAC number
  textMatches?: ReferenceInfo[]; // products whose name appears on the pack
  chain?: ChainInfo;
  ai?: AiInfo;
  now?: Date;
};

export type CheckResult = { verdict: Verdict; findings: Finding[] };

const monthIndex = (d: MonthYear) => d.year * 12 + (d.month - 1);

export function runChecks(input: CheckInput): CheckResult {
  const { fields, reference, chain, ai } = input;
  const now = input.now ?? new Date();
  const thisMonth = monthIndex({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const findings: Finding[] = [];
  const add = (severity: Severity, title: string, detail?: string) => findings.push({ severity, title, detail });

  // --- NAFDAC number -------------------------------------------------------
  if (!fields.nafdacNo) {
    add(
      "amber",
      fields.hasNafdacLabel ? "Couldn't read the NAFDAC number" : "No NAFDAC number found",
      "Every medicine sold legally in Nigeria must show a NAFDAC registration number. Rescan closer, or check the pack yourself. A pack with no number at all is a serious red flag."
    );
  } else if (!isValidNafdacFormat(fields.nafdacNo)) {
    add("red", `NAFDAC number "${fields.nafdacNo}" has an unusual format`, "Real numbers look like A4-1234 or 04-1234.");
  } else if (reference) {
    const upper = input.ocrText.toUpperCase();
    const nameMatches = reference.keywords.some((k) => upper.includes(k));
    const otherProduct = input.textMatches?.find((m) => m.name !== reference.name);
    if (otherProduct && !nameMatches) {
      add(
        "red",
        "NAFDAC number belongs to a different product",
        `${fields.nafdacNo} is registered to ${reference.name} (${reference.manufacturer}), but this pack says ${otherProduct.name}. Counterfeiters often copy a real number from another product.`
      );
    } else if (nameMatches) {
      add("info", `NAFDAC number matches ${reference.name}`, `Registered to ${reference.manufacturer}.${reference.demo ? " (Demo reference data.)" : ""}`);
    } else {
      add("info", `NAFDAC number is registered to ${reference.name}`, "Check that this is the medicine you asked for.");
    }
  } else {
    add("info", `NAFDAC number ${fields.nafdacNo} is not in our reference library yet`, "Look it up on the NAFDAC Greenbook to confirm it belongs to this product.");
  }

  // --- Batch number ---------------------------------------------------------
  if (!fields.batchNo) {
    add("amber", "No batch number found", "Genuine packs always carry a batch or lot number. Rescan the part of the pack with the dates.");
  } else if (reference?.batchPattern && !new RegExp(reference.batchPattern).test(fields.batchNo)) {
    add("amber", `Batch number "${fields.batchNo}" doesn't match how ${reference.manufacturer} prints batches`, "It may be an OCR mistake. Compare it with the pack.");
  }

  // --- Dates ------------------------------------------------------------------
  const { mfd, exp } = fields;
  if (!exp) {
    add("amber", "No expiry date found", "Rescan the part of the pack with the dates.");
  } else if (monthIndex(exp) < thisMonth) {
    add("red", `Expired ${formatMonthYear(exp)}`, "Do not use expired medicine. Return it to the seller.");
  } else if (monthIndex(exp) - thisMonth <= 2) {
    add("amber", `Expires soon (${formatMonthYear(exp)})`);
  }
  if (mfd && monthIndex(mfd) > thisMonth) {
    add("red", `Manufacture date ${formatMonthYear(mfd)} is in the future`, "Genuine packs can't be made in the future. This usually means the dates were tampered with.");
  }
  if (mfd && exp) {
    const shelf = monthIndex(exp) - monthIndex(mfd);
    const max = reference?.maxShelfLifeMonths ?? 60;
    if (shelf <= 0) add("red", "Expiry date is before the manufacture date");
    else if (shelf > max) add("amber", `Shelf life of ${shelf} months is longer than expected (max ${max})`, "Dates may have been changed to extend an expired product.");
  }

  // --- Community reports on-chain --------------------------------------------
  if (chain) {
    if (chain.risk === 2) {
      add("red", "This batch has been CONFIRMED fake by reviewers", `${chain.confirmed} confirmed report(s) on the public registry.`);
    } else if (chain.risk === 1) {
      add("amber", "Other people have reported this batch as suspicious", `${chain.pending} report(s) awaiting review.`);
    } else if (chain.pending > 0) {
      add("info", `${chain.pending} report(s) on this batch awaiting review`);
    }
  }

  // --- AI packaging check ------------------------------------------------------
  if (ai) {
    if (ai.assessment === "likely_fake") add("red", "AI packaging check: pack looks counterfeit");
    else if (ai.assessment === "suspicious") add("amber", "AI packaging check: some packaging details look wrong");
    else if (ai.assessment === "unreadable") add("info", "AI packaging check: photo was too unclear to judge");
    for (const f of ai.findings) add(f.severity, f.message);
  }

  const verdict: Verdict = findings.some((f) => f.severity === "red")
    ? "high"
    : findings.some((f) => f.severity === "amber")
      ? "caution"
      : "clear";
  return { verdict, findings };
}

export const VERDICT_COPY: Record<Verdict, { title: string; body: string }> = {
  high: {
    title: "High risk: don't use this pack",
    body: "We found serious red flags. Don't take it. Show it to a licensed pharmacist, and report it so others are warned.",
  },
  caution: {
    title: "Be careful",
    body: "Some checks failed or couldn't be read. Rescan, or ask a licensed pharmacist to look at the pack.",
  },
  clear: {
    title: "No red flags found",
    body: "This does NOT prove the medicine is genuine: good fakes can look perfect. Buy from licensed pharmacies, and report it if the medicine doesn't work.",
  },
};
