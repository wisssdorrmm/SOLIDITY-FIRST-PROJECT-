# CheckAm: spot fake drugs, warn everyone

Point your phone camera at a medicine pack. CheckAm:

1. **Reads the pack live.** OCR runs on the phone (Tesseract, self-hosted) and pulls out the NAFDAC number, batch number, and manufacture and expiry dates.
2. **Checks it.** It checks the NAFDAC number format and whether it belongs to this product, and flags expired, impossible or tampered dates and odd batch formats.
3. **Looks up community reports onchain.** Reports of fakes live in a Solidity contract, so sellers can't delete or bribe them away. Trusted reviewers confirm or reject them, and a confirmed batch shows up as **CONFIRMED FAKE** for everyone who scans it.
4. **AI packaging check (optional).** Claude compares the photo with the genuine pack (reference notes and photos) and looks for misprints, wrong fonts and colours, and tampering.

People without crypto wallets can still report: the server relays their report onchain.

> CheckAm flags warning signs. It **never** says a drug is genuine, because a camera can't see what's inside a tablet.

```
contracts/   Hardhat project: DrugReportRegistry.sol + tests + deploy script
web/         Next.js app: camera scanner, checks, report relayer, alerts, reviewer page
```

## Run it locally

You need Node 20+.

```bash
# 1. Contracts: test, start a local chain, deploy
cd contracts
npm install
npm test
npm run node                 # leave running (local blockchain on :8545)
npm run deploy:local         # in another terminal; writes web/lib/contract.generated.json

# 2. Web app
cd ../web
npm install                  # also copies the OCR engine into public/tesseract
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY for the AI check
npm run dev                  # http://localhost:3000
```

The camera needs **HTTPS** on phones (`localhost` is fine on a laptop). To try it on your phone during development, use a tunnel such as `ngrok http 3000`, or deploy (see below). The **Upload a photo** button works everywhere.

### Reviewer page

`/review` uses a browser wallet (MetaMask). The deployer account is a reviewer by default. For local testing, import Hardhat's account #0 private key into MetaMask (shown when `npm run node` starts) and add the network `http://127.0.0.1:8545` with chain ID `31337`. Add more reviewers with `setReviewer(address, true)`.

## The smart contract

`contracts/contracts/DrugReportRegistry.sol`

| Function | Who | What |
|---|---|---|
| `submitReport(batchKey, pharmacyId, photoHash, reason, drugName, area)` | anyone (1/min per address), relayers unlimited | Records a report. Only hashes of the photo and pharmacy are stored. |
| `reviewReport(id, Confirmed \| Rejected)` | reviewers | Confirms or rejects a pending report. |
| `batchRisk(batchKey)` | view | `None`, `Suspected` (≥3 pending), or `ConfirmedFake` (≥1 confirmed); thresholds are configurable. |
| `getBatch`, `getPharmacy`, `getReport`, `getRecentReports` | view | Data for the app. |
| `setReviewer`, `setRelayer`, `setThresholds`, `transferOwnership` | owner | Admin. |

`batchKey = keccak256("NAFDACNO|BATCHNO")` (normalised; `NOBATCH` when there's no batch number).

Protections: the same photo can't be reported twice, text fields are capped, non-relayers have a cooldown, and the relayer rate-limits by IP (5 reports per hour).

## Deploy for real (Base Sepolia testnet)

```bash
cd contracts
DEPLOYER_PRIVATE_KEY=0x... RELAYER_ADDRESS=0x... npm run deploy:base-sepolia
```

Then run the web app (for example on Vercel) with:

```
RPC_URL=https://sepolia.base.org
CONTRACT_ADDRESS=0x...       # from the deploy output
CHAIN_ID=84532
RELAYER_PRIVATE_KEY=0x...    # a separate funded wallet, enabled via setRelayer
ANTHROPIC_API_KEY=sk-ant-... # optional
```

Never reuse the Hardhat test key from `.env.example` on a real network.

## Reference library: important

`web/data/references.json` ships with **demo products** (made-up manufacturer and NAFDAC numbers) so the app works end to end. Before real use, replace them with products you have verified on the [NAFDAC Greenbook](https://greenbook.nafdac.gov.ng/), and add photos of genuine packs to `web/public/references/`. Start with the 20 most-faked drugs (antimalarials, antibiotics, painkillers).

## Tests

```bash
cd contracts && npm test     # 18 contract tests
cd web && npm test           # parser + checks unit tests
cd web && npm run build      # typecheck + production build
```

## Roadmap

- Store evidence photos on IPFS so reviewers can see them (only the hash is onchain today)
- USSD / SMS reporting through the relayer
- Pharmacy reputation page (`getPharmacy`)
- Manufacturer-registered batches and unique pack codes (clone detection) once manufacturers join
- Reporter rewards for confirmed reports
