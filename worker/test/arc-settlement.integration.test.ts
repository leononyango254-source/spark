import { ARC_MIN_MAX_FEE_PER_GAS_WEI, createArcPublicClient, getRewardPaidLogs } from "@spark/arc";
import { createViemWalletProvider, type Address } from "@spark/wallet";
import { describe, expect, it } from "vitest";
import { createOnchainSettlement } from "../src/settlement/port";

const enabled = process.env.RUN_ARC_INTEGRATION === "1";

describe.skipIf(!enabled)("Arc testnet settlement (opt-in)", () => {
  it("submits payReward and observes a RewardPaid event", async () => {
    const escrowAddress = process.env.ESCROW_ADDRESS as Address;
    const privateKey = process.env.OPERATOR_PRIVATE_KEY as `0x${string}`;
    const campaignId = BigInt(process.env.IT_CAMPAIGN_ID ?? "1");
    const recipient = (process.env.IT_RECIPIENT ?? "") as Address;
    const rewardId = BigInt(Date.now());
    const nonce = BigInt(Date.now());

    const publicClient = createArcPublicClient(
      process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io",
      Number(process.env.ARC_CHAIN_ID ?? "5042002"),
    );
    const wallet = createViemWalletProvider({
      rpcUrl: process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io",
      chainId: Number(process.env.ARC_CHAIN_ID ?? "5042002"),
      privateKey,
      minMaxFeePerGasWei: ARC_MIN_MAX_FEE_PER_GAS_WEI,
    });
    const settlement = createOnchainSettlement({ wallet, escrowAddress });

    const fromBlock = await publicClient.getBlockNumber();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const { txHash } = await settlement.submitPayout({
      campaignId: "integration",
      rewardId: "integration",
      chainCampaignId: campaignId,
      onChainRewardId: rewardId,
      nonce,
      recipientWallet: recipient,
      amountMicroUsdc: 100_000n,
      deadline,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
    expect(await settlement.getPayoutStatus(txHash)).toBe("confirmed");

    const logs = await getRewardPaidLogs(
      publicClient,
      escrowAddress,
      fromBlock,
      await publicClient.getBlockNumber(),
    );
    expect(logs.some((l) => l.rewardId === rewardId)).toBe(true);
  }, 120_000);
});
