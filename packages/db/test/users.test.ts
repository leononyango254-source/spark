import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearUserWallet,
  updateUserWallet,
  upsertUserByTelegramId,
  type Db,
} from "../src";
import { type Harness, startHarness } from "./harness";

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

describe("user wallet repositories", () => {
  it("updates wallet fields on connect", async () => {
    const u = await upsertUserByTelegramId(db, { telegramUserId: 9100n });
    const updated = await updateUserWallet(db, u.id, {
      address: "0x00000000000000000000000000000000000000A1",
      provider: "walletconnect",
      chainId: 5042002,
    });
    expect(updated.walletAddress).toBe("0x00000000000000000000000000000000000000A1");
    expect(updated.walletProvider).toBe("walletconnect");
    expect(updated.walletStatus).toBe("connected");
    expect(updated.walletChainId).toBe(5042002);
  });

  it("clears wallet fields on disconnect", async () => {
    const u = await upsertUserByTelegramId(db, { telegramUserId: 9101n });
    await updateUserWallet(db, u.id, {
      address: "0x00000000000000000000000000000000000000A1",
      provider: "walletconnect",
      chainId: 5042002,
    });
    const cleared = await clearUserWallet(db, u.id);
    expect(cleared.walletAddress).toBeNull();
    expect(cleared.walletProvider).toBeNull();
    expect(cleared.walletStatus).toBe("disconnected");
    expect(cleared.walletChainId).toBeNull();
  });
});
