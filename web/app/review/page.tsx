"use client";

// Reviewers (pharmacists, NGO staff) confirm or reject reports with their own wallet.
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, type EIP1193Provider } from "viem";
import { registryAbi } from "@/lib/abi.ts";
import ReportList, { type ReportView } from "@/components/ReportList.tsx";
import { useAppConfig } from "@/components/useAppConfig.ts";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export default function ReviewPage() {
  const config = useAppConfig();
  const [account, setAccount] = useState<`0x${string}`>();
  const [isReviewer, setIsReviewer] = useState<boolean>();
  const [reports, setReports] = useState<ReportView[]>([]);
  const [busyId, setBusyId] = useState<number>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const res = await fetch("/api/reports?limit=50");
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setReports(json.reports.filter((r: ReportView) => r.status === "Pending"));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chain = config?.chainId
    ? defineChain({
        id: config.chainId,
        name: `Chain ${config.chainId}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [] } },
      })
    : undefined;

  async function connect() {
    setError(undefined);
    if (!window.ethereum) return setError("No wallet found. Install MetaMask (or open this page in a wallet browser).");
    if (!config?.address || !chain) return setError("Registry is not deployed yet.");
    const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
    const [addr] = await wallet.requestAddresses();
    try {
      await wallet.switchChain({ id: chain.id });
    } catch {
      return setError(`Switch your wallet to chain ${chain.id} (add it in your wallet first).`);
    }
    setAccount(addr);
    const reader = createPublicClient({ chain, transport: custom(window.ethereum) });
    setIsReviewer(await reader.readContract({ address: config.address, abi: registryAbi, functionName: "isReviewer", args: [addr] }));
  }

  async function review(id: number, decision: 1 | 2) {
    if (!window.ethereum || !account || !config?.address || !chain) return;
    setBusyId(id);
    setError(undefined);
    try {
      const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
      const reader = createPublicClient({ chain, transport: custom(window.ethereum) });
      const hash = await wallet.writeContract({
        address: config.address,
        abi: registryAbi,
        functionName: "reviewReport",
        args: [BigInt(id), decision],
      });
      await reader.waitForTransactionReceipt({ hash });
      await load();
    } catch (err) {
      setError((err as { shortMessage?: string })?.shortMessage ?? (err as Error).message);
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <>
      <h1>Review reports</h1>
      <p className="lead">
        For approved reviewers only. Confirm a report after you have examined the pack (or a clear photo) and are sure
        it&apos;s fake. Reject reports that are mistakes or spam.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="card">
        {!account ? (
          <button className="btn block" onClick={() => void connect()}>
            Connect reviewer wallet
          </button>
        ) : (
          <p className="mono">
            {account} {isReviewer ? "· reviewer ✓" : "· not a reviewer (ask the registry owner to add you)"}
          </p>
        )}
      </div>
      <div className="card">
        <h2>Pending reports</h2>
        <ReportList
          reports={reports}
          actions={(r) =>
            isReviewer ? (
              <div className="row" style={{ minWidth: 180 }}>
                <button className="btn danger" disabled={busyId !== undefined} onClick={() => void review(r.id, 1)}>
                  {busyId === r.id ? "…" : "Confirm"}
                </button>
                <button className="btn secondary" disabled={busyId !== undefined} onClick={() => void review(r.id, 2)}>
                  Reject
                </button>
              </div>
            ) : null
          }
        />
      </div>
    </>
  );
}
