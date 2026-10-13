// Server-side access to the registry: reads, and relayed writes for users without wallets.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { registryAbi } from "./abi.ts";

type Deployment = { address: Address; chainId: number };

function loadDeployment(): Deployment | undefined {
  const envAddress = process.env.CONTRACT_ADDRESS;
  if (envAddress && isAddress(envAddress)) {
    return { address: envAddress, chainId: Number(process.env.CHAIN_ID ?? 31337) };
  }
  try {
    const file = path.join(process.cwd(), "lib", "contract.generated.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    if (isAddress(json.address)) return { address: json.address, chainId: Number(process.env.CHAIN_ID ?? json.chainId) };
  } catch {
    // Not deployed yet.
  }
  return undefined;
}

export const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
export const deployment = loadDeployment();

export const chain = defineChain({
  id: deployment?.chainId ?? 31337,
  name: deployment?.chainId === 84532 ? "Base Sepolia" : deployment?.chainId === 31337 ? "Hardhat" : "Registry chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

export const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

export function relayerClient() {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return undefined;
  return createWalletClient({ chain, transport: http(rpcUrl), account: privateKeyToAccount(key as `0x${string}`) });
}

export { registryAbi };

export class NotDeployedError extends Error {
  constructor() {
    super("Registry contract is not deployed. Run the deploy script or set CONTRACT_ADDRESS.");
  }
}

export function requireDeployment(): Deployment {
  if (!deployment) throw new NotDeployedError();
  return deployment;
}

export const REASONS = ["BadNafdacNumber", "PackagingMismatch", "Expired", "NoEffect", "Other"] as const;
export const STATUSES = ["Pending", "Confirmed", "Rejected"] as const;

export type ReportView = {
  id: number;
  batchKey: string;
  pharmacyId: string;
  photoHash: string;
  submitter: string;
  createdAt: number;
  reason: (typeof REASONS)[number];
  status: (typeof STATUSES)[number];
  drugName: string;
  area: string;
};

type RawReport = {
  batchKey: `0x${string}`;
  pharmacyId: `0x${string}`;
  photoHash: `0x${string}`;
  submitter: Address;
  createdAt: bigint;
  reason: number;
  status: number;
  drugName: string;
  area: string;
};

export function toReportView(id: bigint | number, r: RawReport): ReportView {
  return {
    id: Number(id),
    batchKey: r.batchKey,
    pharmacyId: r.pharmacyId,
    photoHash: r.photoHash,
    submitter: r.submitter,
    createdAt: Number(r.createdAt),
    reason: REASONS[r.reason] ?? "Other",
    status: STATUSES[r.status] ?? "Pending",
    drugName: r.drugName,
    area: r.area,
  };
}
