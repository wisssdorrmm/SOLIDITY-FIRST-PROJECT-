import { keccak256, toBytes } from "viem";
import { normalizeBatch, normalizeNafdac } from "./parse.ts";

export const NO_BATCH = "NOBATCH";

/** On-chain key for a batch: keccak256("NAFDACNO|BATCHNO"). */
export function batchKey(nafdacNo: string, batchNo?: string): `0x${string}` {
  const batch = batchNo ? normalizeBatch(batchNo) : NO_BATCH;
  return keccak256(toBytes(`${normalizeNafdac(nafdacNo)}|${batch}`));
}

function normalizePlace(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** On-chain id for a pharmacy, or the zero hash when no name was given. */
export function pharmacyId(name?: string, area?: string): `0x${string}` {
  if (!name || !normalizePlace(name)) return `0x${"0".repeat(64)}`;
  return keccak256(toBytes(`${normalizePlace(name)}|${normalizePlace(area ?? "")}`));
}
