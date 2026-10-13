import { createHash } from "node:crypto";

export interface PayoutRequest {
  campaignId: string;
  rewardId: string;
  nonce: bigint;
  recipientWallet: string;
  amountMicroUsdc: bigint;
}

export interface SettlementPort {
  submitPayout(request: PayoutRequest): Promise<{ txHash: string }>;
  getPayoutStatus(txHash: string): Promise<"pending" | "confirmed" | "failed">;
}

export function createMockSettlement(): SettlementPort {
  const confirmed = new Set<string>();
  const hashFor = (request: PayoutRequest): string =>
    `0x${createHash("sha256")
      .update(`${request.campaignId}:${request.rewardId}:${request.nonce}`)
      .digest("hex")}`;

  return {
    async submitPayout(request) {
      const txHash = hashFor(request);
      confirmed.add(txHash);
      return { txHash };
    },
    async getPayoutStatus(txHash) {
      return confirmed.has(txHash) ? "confirmed" : "failed";
    },
  };
}
