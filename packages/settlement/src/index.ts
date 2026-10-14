import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const SETTLEMENT_CONTRACT = "0x9539efAFf246799827E6F5E6Cbc475122710Ef64";

// Embedded Contract ABI (CampaignEscrow core functions - read-only)
const settleAbi = [
  {
    inputs: [],
    name: "globalPayoutAllowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "maxPayoutPerReward",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "campaignId", type: "uint256" }],
    name: "campaigns",
    outputs: [
      {
        internalType: "address",
        name: "creator",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "budget",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "balance",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "deadline",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "closed",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "campaignId", type: "uint256" },
      { internalType: "uint256", name: "nonce", type: "uint256" },
    ],
    name: "isNonceUsed",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
];

export const settlementClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

/**
 * Gets the global payout allowance from the settlement contract.
 * @returns The remaining allowance in wei/ether as bigint
 */
export async function getGlobalPayoutAllowance(): Promise<bigint> {
  const allowance = await settlementClient.readContract({
    address: SETTLEMENT_CONTRACT,
    abi: settleAbi,
    functionName: "globalPayoutAllowance",
  });
  return allowance as bigint;
}

/**
 * Gets the max payout per reward from the settlement contract.
 * @returns The max payout amount in wei/ether as bigint
 */
export async function getMaxPayoutPerReward(): Promise<bigint> {
  const maxPayout = await settlementClient.readContract({
    address: SETTLEMENT_CONTRACT,
    abi: settleAbi,
    functionName: "maxPayoutPerReward",
  });
  return maxPayout as bigint;
}

/**
 * Gets a campaign's details from the settlement contract.
 * @param campaignId The campaign ID
 * @returns Campaign struct {creator, budget, balance, deadline, closed}
 */
export async function getCampaign(campaignId: bigint) {
  const result = await settlementClient.readContract({
    address: SETTLEMENT_CONTRACT,
    abi: settleAbi,
    functionName: "campaigns",
    args: [campaignId],
  });
  return result as {
    creator: `0x${string}`;
    budget: bigint;
    balance: bigint;
    deadline: bigint;
    closed: boolean;
  };
}

/**
 * Checks if a nonce has already been used.
 * @param campaignId The campaign ID
 * @param nonce The nonce to check
 * @returns True if the nonce is already used
 */
export async function isNonceUsed(campaignId: bigint, nonce: bigint): Promise<boolean> {
  const result = await settlementClient.readContract({
    address: SETTLEMENT_CONTRACT,
    abi: settleAbi,
    functionName: "isNonceUsed",
    args: [campaignId, nonce],
  });
  return result as boolean;
}

/**
 * Gets the settlement contract address.
 * @returns The Arc testnet settlement contract address
 */
export function getSettlementContractAddress(): `0x${string}` {
  return SETTLEMENT_CONTRACT;
}

/**
 * Gets the settle ABI for use by frontend/wallet client.
 * @returns The contract ABI array
 */
export function getSettleAbi(): typeof settleAbi {
  return settleAbi;
}

/**
 * Creates a settlement service instance for API/testing.
 * @param options.projectId WalletConnect project ID (for QR display)
 * @param options.chainId Chain ID (e.g. 5042002 for Arc testnet)
 * @returns Settlement service with submitSettlement/getSettlementStatus
 */
export function createSettlementService({
  // $FlowFixMe $FlowExpectedErrors
  projectId,
  chainId,
}: {
  projectId: string;
  chainId: number;
}): {
  submitSettlement: (
    campaignId: bigint,
    rewardId: bigint,
    nonce: bigint,
    recipient: `0x${string}`,
    amount: bigint,
    deadline: bigint,
  ) => Promise<{ hash: `0x${string}`; awaitReceipt: () => Promise<void> }>;
  getSettlementStatus: (
    txHash: `0x${string}`,
  ) => Promise<{ status: "pending" | "settled"; receipt?: any }>;
} {
  // $FlowFixMe $FlowExpectedErrors
  void projectId;
  void chainId;
  // Mock settlement service for testing/demo.
  // In production, the API routes (@spark/api) handle settlement writes
  // using the WalletConnect signer via viem walletClient.
  return {
    submitSettlement: async () => {
      return {
        hash: `0x${crypto.randomUUID()}`,
        awaitReceipt: async () => {},
      };
    },
    getSettlementStatus: async (txHash: `0x${string}`) => {
      // $FlowFixMe $FlowExpectedErrors
      void txHash;
      // Simulate: after 1 poll, mark as settled
      return { status: "settled" };
    },
  };
}

export {};
