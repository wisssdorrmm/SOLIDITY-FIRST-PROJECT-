"use client";

import { VERDICT_COPY, type ChainInfo, type CheckResult } from "@/lib/checks.ts";
import { formatMonthYear, type PackFields } from "@/lib/parse.ts";

type Props = {
  result: CheckResult;
  fields: PackFields;
  drugName: string;
  chain?: ChainInfo;
  chainNote?: string;
  aiState: "off" | "loading" | "done" | "error";
  aiNote?: string;
  aiConfigured: boolean;
  greenbookUrl: string;
};

export default function Results({ result, fields, drugName, chain, chainNote, aiState, aiNote, aiConfigured, greenbookUrl }: Props) {
  const copy = VERDICT_COPY[result.verdict];
  return (
    <>
      <div className={`verdict ${result.verdict}`} role="status">
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
      </div>

      <div className="card">
        <h2>{drugName || "Scanned pack"}</h2>
        <div className="chips">
          <span className="chip">NAFDAC {fields.nafdacNo ?? "—"}</span>
          <span className="chip">Batch {fields.batchNo ?? "—"}</span>
          <span className="chip">MFD {formatMonthYear(fields.mfd)}</span>
          <span className="chip">EXP {formatMonthYear(fields.exp)}</span>
        </div>
        <ul className="findings">
          {result.findings.map((f, i) => (
            <li key={i} className={f.severity}>
              <strong>{f.title}</strong>
              {f.detail && <span>{f.detail}</span>}
            </li>
          ))}
        </ul>
        {aiState === "loading" && <div className="notice">AI is checking the packaging…</div>}
        {aiState === "error" && <div className="notice">AI packaging check unavailable: {aiNote}</div>}
        {!aiConfigured && <div className="notice">AI packaging check is off on this server. The other checks still ran.</div>}
        {chainNote && <div className="notice">Community reports unavailable: {chainNote}</div>}
        {chain && chain.pending + chain.confirmed + chain.rejected === 0 && (
          <div className="notice">No one has reported this batch yet.</div>
        )}
        {fields.nafdacNo && (
          <p className="hint">
            Double-check the number on the{" "}
            <a href={greenbookUrl} target="_blank" rel="noreferrer">
              NAFDAC Greenbook
            </a>{" "}
            and make sure it belongs to this exact product.
          </p>
        )}
      </div>
    </>
  );
}
