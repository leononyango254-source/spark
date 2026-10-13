import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, TransactionReceiptInfo, WalletProvider } from "./index";

export interface WalletProviderClients {
  address: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
  minMaxFeePerGasWei?: bigint;
  priorityFeePerGasWei?: bigint;
}

const DEFAULT_PRIORITY_FEE = 1_000_000_000n;

export function createWalletProviderFromClients(clients: WalletProviderClients): WalletProvider {
  const { address, publicClient, walletClient } = clients;

  return {
    address,
    async getNonce(blockTag = "pending") {
      return publicClient.getTransactionCount({ address, blockTag });
    },
    async sendTransaction(tx) {
      const nonce =
        tx.nonce ?? (await publicClient.getTransactionCount({ address, blockTag: "pending" }));
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const baseFee = block.baseFeePerGas ?? 0n;
      const doubled = baseFee * 2n;
      const floor = clients.minMaxFeePerGasWei ?? 0n;
      const maxFeePerGas = tx.maxFeePerGas ?? (doubled > floor ? doubled : floor);
      const maxPriorityFeePerGas =
        tx.maxPriorityFeePerGas ??
        clients.priorityFeePerGasWei ??
        (maxFeePerGas < DEFAULT_PRIORITY_FEE ? maxFeePerGas : DEFAULT_PRIORITY_FEE);

      const hash = await walletClient.sendTransaction({
        account: address,
        chain: null,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas: tx.gasLimit,
        nonce,
        maxFeePerGas,
        maxPriorityFeePerGas,
      });
      return { hash, nonce };
    },
    async getReceipt(hash: Hex): Promise<TransactionReceiptInfo | null> {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        return {
          status: receipt.status === "success" ? "success" : "reverted",
          blockNumber: receipt.blockNumber,
          transactionHash: receipt.transactionHash,
        };
      } catch {
        return null;
      }
    },
  };
}

export interface ViemWalletOptions {
  rpcUrl: string;
  chainId: number;
  privateKey: Hex;
  minMaxFeePerGasWei?: bigint;
  priorityFeePerGasWei?: bigint;
}

export function createViemWalletProvider(options: ViemWalletOptions): WalletProvider {
  const account = privateKeyToAccount(options.privateKey);
  const transport = http(options.rpcUrl);
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({ account, transport });
  return createWalletProviderFromClients({
    address: account.address,
    publicClient,
    walletClient,
    ...(options.minMaxFeePerGasWei !== undefined
      ? { minMaxFeePerGasWei: options.minMaxFeePerGasWei }
      : {}),
    ...(options.priorityFeePerGasWei !== undefined
      ? { priorityFeePerGasWei: options.priorityFeePerGasWei }
      : {}),
  });
}