import { NextResponse } from "next/server";
import { deployment, relayerClient } from "@/lib/chain.ts";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    deployed: Boolean(deployment),
    address: deployment?.address ?? null,
    chainId: deployment?.chainId ?? null,
    relayerEnabled: Boolean(relayerClient()),
    aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}
