// Deploys DrugReportRegistry and writes its address for the web app.
//
//   npx hardhat run scripts/deploy.js --network localhost
//   RELAYER_ADDRESS=0x... npx hardhat run scripts/deploy.js --network baseSepolia
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying from ${deployer.address} on ${network.name}`);

  const registry = await (await ethers.getContractFactory("DrugReportRegistry")).deploy();
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  console.log(`DrugReportRegistry deployed to ${address}`);

  // The web app's relayer submits reports for users without wallets.
  const relayer = process.env.RELAYER_ADDRESS || deployer.address;
  await (await registry.setRelayer(relayer, true)).wait();
  console.log(`Relayer enabled: ${relayer}`);

  const { chainId } = await ethers.provider.getNetwork();
  const out = path.join(__dirname, "..", "..", "web", "lib", "contract.generated.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ address, chainId: Number(chainId), network: network.name }, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
