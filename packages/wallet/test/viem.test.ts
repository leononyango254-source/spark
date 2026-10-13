import { describe, expect, it, vi } from "vitest";
import { createWalletProviderFromClients } from "../src";

function fakeClients(
  overrides: { baseFeePerGas?: bigint; receipt?: unknown; nonce?: number } = {},
) {
  const sendTransaction = vi.fn(async () => `0x${"a".repeat(64)}` as const);
  const publicClient = {
    getTransactionCount: vi.fn(async () => overrides.nonce ?? 3),
    getBlock: vi.fn(async () => ({ baseFeePerGas: overrides.baseFeePerGas ?? 0n })),
    getTransactionReceipt: vi.fn(async () => {
      if (overrides.receipt === undefined) throw new Error("not found");
      return overrides.receipt;
    }),
  };
  const walletClient = { sendTransaction };
  return { publicClient, walletClient, sendTransaction };
}

describe("viem wallet provider", () => {
  it("bumps maxFeePerGas above the floor", async () => {
    const { publicClient, walletClient, sendTransaction } = fakeClients({ baseFeePerGas: 5n });
    const provider = createWalletProviderFromClients({
      address: "0x00000000000000000000000000000000000000A1",
      // biome-ignore lint/suspicious/noExplicitAny: test fakes
      publicClient: publicClient as any,
      // biome-ignore lint/suspicious/noExplicitAny: test fakes
      walletClient: walletClient as any,
      minMaxFeePerGasWei: 20_000_000_000n,
    });
    const result = await provider.sendTransaction({
      to: "0x00000000000000000000000000000000000000B2",
      data: "0x",
    });
    expect(result.nonce).toBe(3);
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ maxFeePerGas: 20_000_000_000n }),
    );
  });

  it("doubles base fee when it exceeds the floor", async () => {
    const { publicClient, walletClient, sendTransaction } = fakeClients({
      baseFeePerGas: 50_000_000_000n,
    });
    const provider = createWalletProviderFromClients({
      address: "0x00000000000000000000000000000000000000A1",
      // biome-ignore lint/suspicious/noExplicitAny: test fakes
      publicClient: publicClient as any,
      // biome-ignore lint/suspicious/noExplicitAny: test fakes
      walletClient: walletClient as any,
      minMaxFeePerGasWei: 20_000_000_000n,
    });
    await provider.sendTransaction({
      to: "0x00000000000000000000000000000000000000B2",
      data: "0x",
    });
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ maxFeePerGas: 100_000_000_000n }),
    );
  });

  it("maps a success receipt", async () => {
    const { publicClient, walletClient } = fakeClients({
      receipt: { status: "success", blockNumber: 7n, transactionHash: `0x${"c".repeat(64)}` },
    });
    const provider = createWalletProviderFromClients({
      address: "0x00000000000000000000000000000000000000A1",
      // biome-ignore lint/suspicious/noExplicitAny: test fakes
      publicClient: publicClient as any,
      // biome-ignore lint/suspicious/noExplicitAny: test fakes
      walletClient: walletClient as any,
    });
    expect(await provider.getReceipt(`0x${"c".repeat(64)}`)).toEqual({
      status: "success",
      blockNumber: 7n,
      transactionHash: `0x${"c".repeat(64)}`,
    });
  });

  it("returns null when the receipt is missing", async () => {
    const { publicClient, walletClient } = fakeClients();
    const provider = createWalletProviderFromClients({
      address: "0x00000000000000000000000000000000000000A1",
      // biome-ignore lint/suspicious/noExplicitAny: test fakes
      publicClient: publicClient as any,
      // biome-ignore lint/suspicious/noExplicitAny: test fakes
      walletClient: walletClient as any,
    });
    expect(await provider.getReceipt(`0x${"d".repeat(64)}`)).toBeNull();
  });
});
