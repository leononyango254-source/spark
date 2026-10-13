/**
 * Wallet provider port. Phase 0 decision: the only MVP implementation is a viem EOA
 * (Circle wallets cannot submit Arc mainnet contract calls). The rest of the app depends
 * only on this interface (PRD §33/§36).
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export * from "./viem";

export interface TransactionRequest {
  to: Address;
  data: Hex;
  value?: bigint;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
}

export interface SubmittedTransaction {
  hash: Hex;
  nonce: number;
}

export interface TransactionReceiptInfo {
  status: "success" | "reverted";
  blockNumber: bigint;
  transactionHash: Hex;
}

export interface WalletProvider {
  readonly address: Address;
  getNonce(blockTag?: "latest" | "pending"): Promise<number>;
  sendTransaction(tx: TransactionRequest): Promise<SubmittedTransaction>;
  getReceipt(hash: Hex): Promise<TransactionReceiptInfo | null>;
}
