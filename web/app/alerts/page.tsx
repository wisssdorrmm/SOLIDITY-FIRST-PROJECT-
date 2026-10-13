"use client";

import { useEffect, useState } from "react";
import ReportList, { type ReportView } from "@/components/ReportList.tsx";

type BatchResult = { risk: number; pending: number; confirmed: number; rejected: number; reports: ReportView[] };

const RISK = ["No warnings", "Suspected: reported by several people", "CONFIRMED FAKE"];

export default function AlertsPage() {
  const [reports, setReports] = useState<ReportView[]>();
  const [error, setError] = useState<string>();
  const [nafdac, setNafdac] = useState("");
  const [batch, setBatch] = useState("");
  const [lookup, setLookup] = useState<BatchResult>();
  const [lookupError, setLookupError] = useState<string>();

  useEffect(() => {
    fetch("/api/reports?limit=30")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error);
        setReports(json.reports);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setLookup(undefined);
    setLookupError(undefined);
    const qs = new URLSearchParams({ nafdac, ...(batch ? { batch } : {}) });
    const res = await fetch(`/api/batch?${qs}`);
    const json = await res.json();
    if (res.ok) setLookup(json);
    else setLookupError(json.error);
  }

  return (
    <>
      <h1>Fake drug alerts</h1>
      <p className="lead">Reports from people across Nigeria, stored on a public blockchain so they can&apos;t be deleted.</p>

      <form className="card" onSubmit={search}>
        <h2>Check a batch</h2>
        <div className="row">
          <div>
            <label htmlFor="a-nafdac">NAFDAC number</label>
            <input id="a-nafdac" value={nafdac} onChange={(e) => setNafdac(e.target.value)} placeholder="A4-1234" required />
          </div>
          <div>
            <label htmlFor="a-batch">Batch number</label>
            <input id="a-batch" value={batch} onChange={(e) => setBatch(e.target.value)} />
          </div>
        </div>
        <div style={{ height: 12 }} />
        <button className="btn block">Look up</button>
        {lookupError && <div className="error">{lookupError}</div>}
        {lookup && (
          <div style={{ marginTop: 12 }}>
            <div className={`verdict ${lookup.risk === 2 ? "high" : lookup.risk === 1 ? "caution" : "clear"}`}>
              <h2>{RISK[lookup.risk]}</h2>
              <p>
                {lookup.confirmed} confirmed · {lookup.pending} pending · {lookup.rejected} rejected
              </p>
            </div>
            <ReportList reports={lookup.reports} />
          </div>
        )}
      </form>

      <div className="card">
        <h2>Latest reports</h2>
        {error && <div className="error">{error}</div>}
        {!reports && !error && <p className="hint">Loading…</p>}
        {reports && <ReportList reports={reports} />}
      </div>
    </>
  );
}
