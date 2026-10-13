"use client";

import { useState } from "react";
import { sha256Hex } from "@/lib/ocr.ts";
import type { PackFields } from "@/lib/parse.ts";

const REASONS = [
  ["PackagingMismatch", "Packaging looks wrong"],
  ["BadNafdacNumber", "NAFDAC number is wrong or missing"],
  ["Expired", "Expired or dates look changed"],
  ["NoEffect", "The medicine didn't work"],
  ["Other", "Something else"],
] as const;

type Props = {
  snapshot: string;
  fields: PackFields;
  drugName: string;
  suggestedReason?: (typeof REASONS)[number][0];
  onCancel: () => void;
};

export default function ReportForm({ snapshot, fields, drugName: initialDrug, suggestedReason, onCancel }: Props) {
  const [drugName, setDrugName] = useState(initialDrug);
  const [area, setArea] = useState("");
  const [pharmacyName, setPharmacyName] = useState("");
  const [reason, setReason] = useState<string>(suggestedReason ?? "PackagingMismatch");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ reportId?: number; txHash: string }>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nafdacNo: fields.nafdacNo,
          batchNo: fields.batchNo,
          drugName,
          area,
          pharmacyName: pharmacyName || undefined,
          reason,
          photoHash: await sha256Hex(snapshot),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDone(json);
    } catch (err) {
      setError((err as Error)?.message || "Couldn't submit the report.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card">
        <div className="success">
          <strong>Thank you! Your report is on the public registry{done.reportId !== undefined ? ` (#${done.reportId})` : ""}.</strong>
          <br />
          Reviewers will check it. Anyone who scans this batch will now see the warning.
        </div>
        <p className="hint">Transaction</p>
        <p className="mono">{done.txHash}</p>
        <p className="hint">Keep the pack and your receipt. You can also report it to NAFDAC directly.</p>
        <button className="btn secondary block" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Report this pack</h2>
      <p className="hint">
        Your report goes on a public blockchain so nobody can delete it. Only a fingerprint of your photo is stored,
        not the photo. Don&apos;t include personal details.
      </p>
      <label htmlFor="r-drug">Drug name</label>
      <input id="r-drug" value={drugName} onChange={(e) => setDrugName(e.target.value)} required minLength={2} maxLength={96} />
      <label htmlFor="r-area">Where did you buy it?</label>
      <input id="r-area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Idumota, Lagos" required minLength={2} maxLength={96} />
      <label htmlFor="r-pharm">Pharmacy or shop name (optional)</label>
      <input id="r-pharm" value={pharmacyName} onChange={(e) => setPharmacyName(e.target.value)} maxLength={96} />
      <label htmlFor="r-reason">What&apos;s wrong?</label>
      <select id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
        {REASONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {error && <div className="error">{error}</div>}
      <div style={{ height: 14 }} />
      <div className="row">
        <button type="button" className="btn secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn danger" disabled={busy}>
          {busy ? "Submitting…" : "Submit report"}
        </button>
      </div>
    </form>
  );
}
