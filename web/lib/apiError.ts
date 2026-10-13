import "server-only";
import { NextResponse } from "next/server";
import { NotDeployedError } from "./chain.ts";

export function chainError(err: unknown) {
  if (err instanceof NotDeployedError) return NextResponse.json({ error: err.message, notDeployed: true }, { status: 503 });
  console.error(err);
  return NextResponse.json({ error: "Couldn't reach the blockchain. Try again shortly." }, { status: 502 });
}
