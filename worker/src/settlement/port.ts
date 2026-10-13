import { encodePayReward } from "@spark/arc";
import type { PayoutRequest, SettlementPort } from "@spark/reward";
import type { Address, Hex, WalletProvider } from "@spark/wallet";

export interface OnchainSettlementDeps {
  wallet: WalletProvider;
  escrowAddress: Address;
}

export function createOnchainSettlement(deps: OnchainSettlementDeps): SettlementPort {
  return {
    async submitPayout(request: PayoutRequest) {
      const data = encodePayReward({
        campaignId: request.chainCampaignId,
        rewardId: request.onChainRewardId,
        nonce: request.nonce,
        recipient: request.recipientWallet as Address,
        amount: request.amountMicroUsdc,
        deadline: request.deadline,
      });
      const { hash } = await deps.wallet.sendTransaction({ to: deps.escrowAddress, data });
      return { txHash: hash };
    },
    async getPayoutStatus(txHash: string) {
      const receipt = await deps.wallet.getReceipt(txHash as Hex);
      if (!receipt) return "pending";
      return receipt.status === "success" ? "confirmed" : "failed";
    },
  };
}
