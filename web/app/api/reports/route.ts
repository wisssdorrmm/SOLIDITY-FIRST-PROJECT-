import { NextResponse } from "next/server";
import { publicClient, registryAbi, requireDeployment, toReportView } from "@/lib/chain.ts";
import { chainError } from "@/lib/apiError.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
  try {
    const { address } = requireDeployment();
    const [[page, ids], total] = await Promise.all([
      publicClient.readContract({
        address,
        abi: registryAbi,
        functionName: "getRecentReports",
        args: [BigInt(offset), BigInt(limit)],
      }),
      publicClient.readContract({ address, abi: registryAbi, functionName: "reportCount" }),
    ]);
    return NextResponse.json({
      total: Number(total),
      reports: page.map((r, i) => toReportView(ids[i], r)),
    });
  } catch (err) {
    return chainError(err);
  }
}
