import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isAddress } from "viem";
import {
  createDb,
  type Db,
  findOrCreateUserByTelegramId,
  upsertWalletAssociation,
} from "@spark/db";
import { loadWorkerEnv } from "../env";

export async function associateWallet(
  db: Db,
  input: { campaignId: string; telegramUserId: bigint; address: string },
): Promise<void> {
  const address = input.address;
  if (!isAddress(address, { strict: false })) {
    throw new Error("invalid address");
  }
  const user = await findOrCreateUserByTelegramId(db, input.telegramUserId);
  await upsertWalletAssociation(db, {
    campaignId: input.campaignId,
    userId: user.id,
    address: address,
    normalizedAddress: address.toLowerCase(),
  });
}

async function main(): Promise<void> {
  const [campaignDbId, telegramUserIdRaw, address] = process.argv.slice(2);
  if (!campaignDbId || !telegramUserIdRaw || !address) {
    throw new Error(
      "usage: node src/scripts/associate-wallet.ts <campaign-db-uuid> <telegram-user-id> <address>",
    );
  }
  const env = loadWorkerEnv();
  const { db, pool } = createDb(env.DATABASE_URL);
  try {
    await associateWallet(db, {
      campaignId: campaignDbId,
      telegramUserId: BigInt(telegramUserIdRaw),
      address,
    });
    console.info(`associated ${address} with telegram user ${telegramUserIdRaw}`);
  } finally {
    await pool.end();
  }
}

function isEntrypoint(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
