import { pathToFileURL } from "node:url";
import { createDb, type Db, upsertUserByTelegramId, upsertWalletAssociation } from "@spark/db";
import { loadWorkerEnv } from "../env";

export async function associateWallet(
  db: Db,
  input: { campaignId: string; telegramUserId: bigint; address: string },
): Promise<void> {
  const user = await upsertUserByTelegramId(db, { telegramUserId: input.telegramUserId });
  await upsertWalletAssociation(db, {
    campaignId: input.campaignId,
    userId: user.id,
    address: input.address,
    normalizedAddress: input.address.toLowerCase(),
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

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
