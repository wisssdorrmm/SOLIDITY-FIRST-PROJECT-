"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runChecks, type AiInfo, type ChainInfo, type CheckResult } from "@/lib/checks.ts";
import { captureToCanvas, getOcrWorker, recognize } from "@/lib/ocr.ts";
import { formatMonthYear, mergeFields, parseMonthYear, parsePackText, type PackFields } from "@/lib/parse.ts";
import { findByNafdac, findByText, NAFDAC_GREENBOOK_URL } from "@/lib/references.ts";
import { useAppConfig } from "./useAppConfig.ts";
import ReportForm from "./ReportForm.tsx";
import Results from "./Results.tsx";

type Stage = "start" | "scanning" | "confirm" | "results";

const EMPTY: PackFields = { hasNafdacLabel: false };
const MAX_TEXTS = 6;

type Form = { nafdacNo: string; batchNo: string; mfd: string; exp: string; drugName: string };

function toForm(f: PackFields, ocrText: string): Form {
  // Suggest a name only from what is printed on the pack. Filling it in from the
  // NAFDAC number would hide a number borrowed from another product.
  const ref = findByText(ocrText)[0];
  return {
    nafdacNo: f.nafdacNo ?? "",
    batchNo: f.batchNo ?? "",
    mfd: f.mfd ? formatMonthYear(f.mfd) : "",
    exp: f.exp ? formatMonthYear(f.exp) : "",
    drugName: ref?.name ?? "",
  };
}

function fromForm(form: Form): PackFields {
  return {
    nafdacNo: form.nafdacNo.trim() || undefined,
    batchNo: form.batchNo.trim().toUpperCase() || undefined,
    mfd: parseMonthYear(form.mfd),
    exp: parseMonthYear(form.exp),
    hasNafdacLabel: Boolean(form.nafdacNo.trim()),
  };
}

export default function Scanner() {
  const config = useAppConfig();
  const [stage, setStage] = useState<Stage>("start");
  const [fields, setFields] = useState<PackFields>(EMPTY);
  const [texts, setTexts] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<string>();
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string>();
  const [form, setForm] = useState<Form>({ nafdacNo: "", batchNo: "", mfd: "", exp: "", drugName: "" });

  const [chain, setChain] = useState<ChainInfo>();
  const [chainNote, setChainNote] = useState<string>();
  const [ai, setAi] = useState<AiInfo>();
  const [aiState, setAiState] = useState<"off" | "loading" | "done" | "error">("off");
  const [aiNote, setAiNote] = useState<string>();
  const [result, setResult] = useState<CheckResult>();
  const [showReport, setShowReport] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const snapshotRef = useRef<string | undefined>(undefined);
  const ocrText = texts.join("\n");

  // ------------------------------------------------------------------ camera
  const finishScan = useCallback((merged: PackFields, allText: string) => {
    setForm(toForm(merged, allText));
    setStage("confirm");
  }, []);

  useEffect(() => {
    if (stage !== "scanning") return;
    let active = true;
    let stream: MediaStream | undefined;
    let merged: PackFields = EMPTY;
    const seen: string[] = [];

    (async () => {
      try {
        setStatus("Starting camera…");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setStatus("Loading text reader…");
        await getOcrWorker();
        setStatus("Hold the pack steady. Point at the NAFDAC number, batch number and dates.");

        while (active) {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            const frame = captureToCanvas(video);
            const text = await recognize(frame);
            if (!active) break;
            const next = parsePackText(text);
            const before = JSON.stringify(merged);
            merged = mergeFields(merged, next);
            if (text.trim()) {
              seen.push(text);
              if (seen.length > MAX_TEXTS) seen.shift();
              setTexts([...seen]);
            }
            // Keep the frame that taught us something as the evidence photo.
            if (JSON.stringify(merged) !== before || !snapshotRef.current) {
              snapshotRef.current = frame.toDataURL("image/jpeg", 0.85);
              setSnapshot(snapshotRef.current);
            }
            setFields(merged);
            if (merged.nafdacNo && merged.batchNo && merged.exp) {
              setStatus("Got it!");
              finishScan(merged, seen.join("\n"));
              break;
            }
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (err) {
        if (!active) return;
        const name = (err as Error)?.name;
        setError(
          name === "NotAllowedError"
            ? "Camera permission was blocked. Allow camera access, or upload a photo instead."
            : name === "NotFoundError"
              ? "No camera found. Upload a photo instead."
              : `Couldn't start scanning: ${(err as Error)?.message ?? err}`
        );
        setStage("start");
      }
    })();

    return () => {
      active = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stage, finishScan]);

  function startScan() {
    setError(undefined);
    setFields(EMPTY);
    setTexts([]);
    setSnapshot(undefined);
    snapshotRef.current = undefined;
    setResult(undefined);
    setAi(undefined);
    setChain(undefined);
    setShowReport(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the camera here (it needs HTTPS). Upload a photo instead.");
      return;
    }
    setStage("scanning");
  }

  async function onUpload(file: File) {
    setError(undefined);
    setResult(undefined);
    setAi(undefined);
    setChain(undefined);
    setShowReport(false);
    setStatus("Reading photo…");
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = captureToCanvas(img);
      URL.revokeObjectURL(url);
      const shot = canvas.toDataURL("image/jpeg", 0.85);
      snapshotRef.current = shot;
      setSnapshot(shot);
      const text = await recognize(canvas);
      const f = parsePackText(text);
      setTexts([text]);
      setFields(f);
      finishScan(f, text);
    } catch (err) {
      setError(`Couldn't read that photo: ${(err as Error)?.message ?? err}`);
    } finally {
      setStatus("");
    }
  }

  // ------------------------------------------------------------------ checks
  async function runAllChecks() {
    const f = fromForm(form);
    const textForChecks = [ocrText, form.drugName].filter(Boolean).join("\n");
    setFields(f);
    setStage("results");
    setShowReport(false);

    const compute = (chainInfo?: ChainInfo, aiInfo?: AiInfo, extra?: PackFields) => {
      const merged = extra ? mergeFields(f, extra) : f;
      setResult(
        runChecks({
          fields: merged,
          ocrText: textForChecks,
          reference: findByNafdac(merged.nafdacNo),
          textMatches: findByText(textForChecks),
          chain: chainInfo,
          ai: aiInfo,
        })
      );
    };
    compute();

    let chainInfo: ChainInfo | undefined;
    setChainNote(undefined);
    if (f.nafdacNo) {
      try {
        const qs = new URLSearchParams({ nafdac: f.nafdacNo, ...(f.batchNo ? { batch: f.batchNo } : {}) });
        const res = await fetch(`/api/batch?${qs}`);
        const json = await res.json();
        if (res.ok) {
          chainInfo = { risk: json.risk, pending: json.pending, confirmed: json.confirmed, rejected: json.rejected };
          setChain(chainInfo);
        } else {
          setChainNote(json.error);
        }
      } catch {
        setChainNote("Couldn't reach the report registry.");
      }
      compute(chainInfo);
    }

    if (config?.aiEnabled && snapshotRef.current) {
      setAiState("loading");
      setAiNote(undefined);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: snapshotRef.current, ocrText: textForChecks, nafdacNo: f.nafdacNo }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        const aiInfo: AiInfo = { assessment: json.assessment, findings: json.findings };
        setAi(aiInfo);
        setAiState("done");
        // Fill in anything the phone OCR missed but the AI could read.
        const read = json.readText ?? {};
        const extra: PackFields = {
          nafdacNo: read.nafdacNo ?? undefined,
          batchNo: read.batchNo ? String(read.batchNo).toUpperCase().replace(/\s+/g, "") : undefined,
          mfd: read.mfd ? parseMonthYear(read.mfd) : undefined,
          exp: read.exp ? parseMonthYear(read.exp) : undefined,
          hasNafdacLabel: false,
        };
        compute(chainInfo, aiInfo, extra);
        setFields((prev) => mergeFields(prev, extra));
        if (!form.drugName && read.drugName) setForm((prev) => ({ ...prev, drugName: read.drugName }));
      } catch (err) {
        setAiState("error");
        setAiNote((err as Error)?.message || "AI check failed.");
      }
    } else {
      setAiState("off");
    }
  }

  // ------------------------------------------------------------------ render
  if (stage === "start") {
    return (
      <>
        <h1>Is this drug fake?</h1>
        <p className="lead">
          Point your camera at the medicine pack. CheckAm reads the NAFDAC number, batch number and dates, checks them,
          and looks up community reports of fakes.
        </p>
        {error && <div className="error">{error}</div>}
        <div className="card">
          <button className="btn block" onClick={startScan}>
            📷 Scan a pack
          </button>
          <div style={{ height: 10 }} />
          <button className="btn secondary block" onClick={() => fileRef.current?.click()}>
            Upload a photo instead
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onUpload(file);
              e.target.value = "";
            }}
          />
          {status && <p className="hint">{status}</p>}
          <p className="hint">Text is read on your phone. Nothing is uploaded unless you run the AI check or report a fake.</p>
        </div>
        <div className="card">
          <h2>What we check</h2>
          <ol className="steps">
            <li>NAFDAC number format, and whether it belongs to this product</li>
            <li>Batch number, and manufacture and expiry dates (expired, tampered, impossible)</li>
            <li>Reports from other people on a public, tamper-proof registry</li>
            {config?.aiEnabled && <li>AI check of the packaging for signs of a fake</li>}
          </ol>
        </div>
      </>
    );
  }

  if (stage === "scanning") {
    const found = (ok: unknown, label: string) => <span className={`chip ${ok ? "ok" : ""}`}>{ok ? "✓ " : ""}{label}</span>;
    return (
      <>
        <div className="camera">
          <video ref={videoRef} playsInline muted />
          <div className="frame" />
          <div className="status">{status}</div>
        </div>
        <div className="chips">
          {found(fields.nafdacNo, fields.nafdacNo ? `NAFDAC ${fields.nafdacNo}` : "NAFDAC no.")}
          {found(fields.batchNo, fields.batchNo ? `Batch ${fields.batchNo}` : "Batch no.")}
          {found(fields.mfd, fields.mfd ? `MFD ${formatMonthYear(fields.mfd)}` : "MFD")}
          {found(fields.exp, fields.exp ? `EXP ${formatMonthYear(fields.exp)}` : "EXP")}
        </div>
        <div className="row">
          <button className="btn secondary" onClick={() => setStage("start")}>
            Cancel
          </button>
          <button className="btn" onClick={() => finishScan(fields, ocrText)}>
            Done, check it
          </button>
        </div>
      </>
    );
  }

  if (stage === "confirm") {
    const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
    return (
      <>
        <h1>Check what we read</h1>
        <p className="lead">Fix anything the camera got wrong, then run the checks.</p>
        <div className="card">
          {snapshot && <img src={snapshot} alt="Scanned pack" className="preview" />}
          <label htmlFor="drug">Drug name</label>
          <input id="drug" value={form.drugName} onChange={set("drugName")} placeholder="e.g. Amoxicillin 500mg" />
          <label htmlFor="nafdac">NAFDAC number</label>
          <input id="nafdac" value={form.nafdacNo} onChange={set("nafdacNo")} placeholder="e.g. A4-1234" autoCapitalize="characters" />
          <label htmlFor="batch">Batch / lot number</label>
          <input id="batch" value={form.batchNo} onChange={set("batchNo")} autoCapitalize="characters" />
          <div className="row">
            <div>
              <label htmlFor="mfd">Manufactured</label>
              <input id="mfd" value={form.mfd} onChange={set("mfd")} placeholder="MM/YYYY" inputMode="numeric" />
            </div>
            <div>
              <label htmlFor="exp">Expires</label>
              <input id="exp" value={form.exp} onChange={set("exp")} placeholder="MM/YYYY" inputMode="numeric" />
            </div>
          </div>
          <div style={{ height: 14 }} />
          <div className="row">
            <button className="btn secondary" onClick={startScan}>
              Rescan
            </button>
            <button className="btn" onClick={() => void runAllChecks()}>
              Run checks
            </button>
          </div>
        </div>
      </>
    );
  }

  // results
  return (
    <>
      {result && (
        <Results
          result={result}
          fields={fields}
          drugName={form.drugName}
          chain={chain}
          chainNote={chainNote}
          aiState={aiState}
          aiNote={aiNote}
          aiConfigured={Boolean(config?.aiEnabled)}
          greenbookUrl={NAFDAC_GREENBOOK_URL}
        />
      )}
      {showReport && snapshot ? (
        <ReportForm
          snapshot={snapshot}
          fields={fields}
          drugName={form.drugName}
          suggestedReason={result?.findings.find((f) => f.title.startsWith("Expired")) ? "Expired" : undefined}
          onCancel={() => setShowReport(false)}
        />
      ) : (
        <div className="row">
          <button className="btn secondary" onClick={startScan}>
            Scan another pack
          </button>
          <button
            className="btn danger"
            onClick={() => setShowReport(true)}
            disabled={!snapshot || !fields.nafdacNo}
            title={!fields.nafdacNo ? "A NAFDAC number is needed to file a report" : undefined}
          >
            Report this pack
          </button>
        </div>
      )}
      {!fields.nafdacNo && <p className="hint">Add the NAFDAC number (Rescan or edit) to report this pack.</p>}
    </>
  );
}
