import { NextResponse } from "next/server";
import { chainError } from "@/lib/apiError.ts";
import { publicClient, registryAbi, requireDeployment, toReportView } from "@/lib/chain.ts";
import { batchKey } from "@/lib/keys.ts";
import { isValidNafdacFormat } from "@/lib/parse.ts";

export const dynamic = "force-dynamic";

const MAX_REPORTS = 20;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nafdac = url.searchParams.get("nafdac") ?? "";
  const batch = url.searchParams.get("batch") ?? undefined;
  if (!isValidNafdacFormat(nafdac)) {
    return NextResponse.json({ error: "Provide a valid NAFDAC number, e.g. A4-1234" }, { status: 400 });
  }
  try {
    const { address } = requireDeployment();
    const key = batchKey(nafdac, batch);
    const [stats, risk, ids] = await publicClient.readContract({
      address,
      abi: registryAbi,
      functionName: "getBatch",
      args: [key],
    });
    const latest = [...ids].reverse().slice(0, MAX_REPORTS);
    const reports = await Promise.all(
      latest.map(async (id) =>
        toReportView(id, await publicClient.readContract({ address, abi: registryAbi, functionName: "getReport", args: [id] }))
      )
    );
    return NextResponse.json({
      batchKey: key,
      risk,
      pending: stats.pending,
      confirmed: stats.confirmed,
      rejected: stats.rejected,
      totalReports: ids.length,
      reports,
    });
  } catch (err) {
    return chainError(err);
  }
}

