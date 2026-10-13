import {
  ARC_USDC_ADDRESS,
  campaignEscrowAbi,
  createArcPublicClient,
  encodeApprove,
  encodeCreateCampaign,
  encodeFundCampaign,
} from "@spark/arc";
import { createDb, setCampaignOnChainId } from "@spark/db";
import {
  createWalletClient,
  http,
  decodeEventLog,
  type Address,
  type Hex,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadWorkerEnv } from "../env";

async function main(): Promise<void> {
  const campaignDbId = process.argv[2];
  if (!campaignDbId) {
    throw new Error("usage: node src/scripts/seed-campaign.ts <campaign-db-uuid>");
  }
  const budget = BigInt(process.argv[3] ?? "1000000");

  const env = loadWorkerEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
  const account = privateKeyToAccount(env.OPERATOR_PRIVATE_KEY as `0x${string}`);
  const transport = http(env.ARC_RPC_URL);
  const arcChain = defineChain({
    id: env.ARC_CHAIN_ID,
    name: "arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [env.ARC_RPC_URL] } },
  });

  const publicClient = createArcPublicClient(env.ARC_RPC_URL, env.ARC_CHAIN_ID);
  const walletClient = createWalletClient({ account, transport, chain: arcChain });

  const escrow = env.ESCROW_ADDRESS as Address;
  const usdc = ARC_USDC_ADDRESS as Address;

  const approveHash = await walletClient.sendTransaction({
    account,
    to: usdc,
    data: encodeApprove(escrow, budget),
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
  const createHash = await walletClient.sendTransaction({
    account,
    to: escrow,
    data: encodeCreateCampaign(account.address, budget, deadline),
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

  let onChainCampaignId: bigint | null = null;
  for (const log of createReceipt.logs) {
    if (log.address.toLowerCase() !== escrow.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: campaignEscrowAbi,
        eventName: "CampaignCreated",
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      onChainCampaignId = (decoded.args as unknown as { id: bigint }).id;
      break;
    } catch {
      // not the event we want
    }
  }
  if (onChainCampaignId === null) throw new Error("CampaignCreated event not found");

  const fundHash = await walletClient.sendTransaction({
    account,
    to: escrow,
    data: encodeFundCampaign(onChainCampaignId, budget),
  });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });

  await setCampaignOnChainId(db, campaignDbId, onChainCampaignId, escrow);
  console.info(
    `seeded campaign ${campaignDbId} -> on-chain id ${onChainCampaignId} at ${escrow} (funded ${budget})`,
  );
  await pool.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
