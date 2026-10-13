import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const SETTLEMENT_CONTRACT = "0x9539efAFf246799827E6F5E6Cbc475122710Ef64";

const chain = sepolia;

const settlementClient = createPublicClient({
  chain,
  transport: http(),
});

async function getUserBalance(
  userAddress: `0x${string}`,
  _chainId: number
): Promise<bigint> {
  const balance = await settlementClient.readContract({
    address: SETTLEMENT_CONTRACT,
    abi: [],
    functionName: "getBalance",
    args: [userAddress],
  });
  return balance as bigint;
}

async function submitSettlement(
  userAddress: `0x${string}`,
  amount: bigint,
  _chainId: number,
  walletConnectMgr: any
): Promise<{ hash: `0x${string}`; awaitReceipt: () => Promise<void> }> {
  const [signer] = await walletConnectMgr.getSigner ? walletConnectMgr.getSigner() : [];

  const hash = await (settlementClient as any).writeContract({
    address: SETTLEMENT_CONTRACT,
    abi: [],
    functionName: "submitSettlement",
    args: [userAddress, amount],
    chain: _chainId,
    account: signer,
  });

  return {
    hash,
    awaitReceipt: async () => await (settlementClient as any).waitForReceipt({ hash }),
  };
}

async function getSettlementStatus(
  txHash: `0x${string}`,
  intervalMs = 3_000,
  timeoutMs = 30_000
): Promise<{ status: "pending" | "settled"; receipt?: any }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await (settlementClient as any).waitForReceipt({ hash: txHash, timeout: intervalMs });
      return { status: "settled", receipt };
    } catch {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return { status: "pending" };
}

export { getUserBalance, submitSettlement, getSettlementStatus, SETTLEMENT_CONTRACT };