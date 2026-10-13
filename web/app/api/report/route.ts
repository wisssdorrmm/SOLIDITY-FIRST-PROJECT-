// Relays a report on-chain so people without a crypto wallet can still report fakes.
import { NextResponse } from "next/server";
import { z } from "zod";
import { decodeEventLog } from "viem";
import { chainError } from "@/lib/apiError.ts";
import { publicClient, REASONS, registryAbi, relayerClient, requireDeployment } from "@/lib/chain.ts";
import { batchKey, pharmacyId } from "@/lib/keys.ts";
import { isValidNafdacFormat } from "@/lib/parse.ts";
import { clientIp, rateLimit } from "@/lib/rateLimit.ts";

export const dynamic = "force-dynamic";

const text = (max: number) => z.string().trim().max(max);

const ReportSchema = z.object({
  nafdacNo: z.string().refine(isValidNafdacFormat, "Invalid NAFDAC number"),
  batchNo: text(32).optional(),
  drugName: text(96).min(2, "Enter the drug name"),
  area: text(96).min(2, "Enter where you bought it"),
  pharmacyName: text(96).optional(),
  reason: z.enum(REASONS),
  photoHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Missing photo fingerprint"),
});

export async function POST(req: Request) {
  if (!rateLimit(`report:${clientIp(req)}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many reports from this connection. Try again in an hour." }, { status: 429 });
  }

  const parsed = ReportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid report" }, { status: 400 });
  }
  const r = parsed.data;

  const wallet = relayerClient();
  if (!wallet) {
    return NextResponse.json({ error: "Reporting is not configured on this server (RELAYER_PRIVATE_KEY missing)." }, { status: 503 });
  }

  try {
    const { address } = requireDeployment();
    const { request } = await publicClient.simulateContract({
      address,
      abi: registryAbi,
      functionName: "submitReport",
      args: [
        batchKey(r.nafdacNo, r.batchNo || undefined),
        pharmacyId(r.pharmacyName, r.area),
        r.photoHash as `0x${string}`,
        REASONS.indexOf(r.reason),
        r.drugName,
        r.area,
      ],
      account: wallet.account,
    });
    const hash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    let reportId: number | undefined;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "ReportSubmitted") reportId = Number(ev.args.reportId);
      } catch {
        // Not one of our events.
      }
    }
    return NextResponse.json({ reportId, txHash: hash });
  } catch (err) {
    const name = (err as { cause?: { data?: { errorName?: string } } })?.cause?.data?.errorName;
    if (name === "PhotoAlreadyReported") {
      return NextResponse.json({ error: "This exact photo has already been reported." }, { status: 409 });
    }
    return chainError(err);
  }
}
