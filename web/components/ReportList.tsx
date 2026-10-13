"use client";

import type { ReactNode } from "react";

export type ReportView = {
  id: number;
  batchKey: string;
  pharmacyId: string;
  submitter: string;
  createdAt: number;
  reason: string;
  status: "Pending" | "Confirmed" | "Rejected";
  drugName: string;
  area: string;
};

const REASON_LABEL: Record<string, string> = {
  BadNafdacNumber: "Bad NAFDAC number",
  PackagingMismatch: "Packaging looks wrong",
  Expired: "Expired / dates changed",
  NoEffect: "Didn't work",
  Other: "Other",
};

export default function ReportList({ reports, actions }: { reports: ReportView[]; actions?: (r: ReportView) => ReactNode }) {
  if (reports.length === 0) return <p className="hint">No reports yet.</p>;
  return (
    <div>
      {reports.map((r) => (
        <div key={r.id} className="report-item">
          <div>
            <strong>{r.drugName}</strong> <span className={`badge ${r.status}`}>{r.status}</span>
            <div className="hint">
              {REASON_LABEL[r.reason] ?? r.reason} · {r.area} · {new Date(r.createdAt * 1000).toLocaleDateString()}
            </div>
            <div className="mono hint">batch {r.batchKey.slice(0, 10)}… · report #{r.id}</div>
          </div>
          {actions && <div>{actions(r)}</div>}
        </div>
      ))}
    </div>
  );
}
