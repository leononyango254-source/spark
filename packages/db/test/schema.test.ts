import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "./harness";

let h: Harness;

const pgErrorCode = (err: unknown): string | undefined =>
  typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;

async function seedUser(telegramId: number): Promise<string> {
  const { rows } = await h.pool.query<{ id: string }>(
    "INSERT INTO users (telegram_user_id) VALUES ($1) RETURNING id",
    [telegramId],
  );
  return rows[0]!.id;
}

async function seedCampaign(creatorId: string): Promise<string> {
  const { rows } = await h.pool.query<{ id: string }>(
    `INSERT INTO campaigns
       (public_id, creator_id, chain_id, reward_micro_usdc, referral_reward_micro_usdc,
        budget_micro_usdc, balance_micro_usdc)
     VALUES ($1, $2, 5042002, 100000, 0, 25000000, 0) RETURNING id`,
    [`pub${Math.random().toString(36).slice(2, 12)}`, creatorId],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h?.stop();
});

describe("schema constraints", () => {
  it("creates every table", async () => {
    const { rows } = await h.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      "users",
      "sessions",
      "campaigns",
      "tasks",
      "participations",
      "referrals",
      "rewards",
      "ledger_entries",
      "wallet_associations",
      "blockchain_transactions",
      "campaign_events",
      "creator_funding_handoffs",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("enforces users.telegram_user_id UNIQUE", async () => {
    await seedUser(7001);
    await expect(seedUser(7001)).rejects.toSatisfy((e) => pgErrorCode(e) === "23505");
  });

  it("enforces participations(campaign_id, user_id) UNIQUE and no self-referral", async () => {
    const uid = await seedUser(7002);
    const cid = await seedCampaign(uid);
    const { rows } = await h.pool.query<{ id: string }>(
      "INSERT INTO tasks (campaign_id, type, reward_micro_usdc) VALUES ($1, 'TELEGRAM_CHANNEL_MEMBERSHIP', 100000) RETURNING id",
      [cid],
    );
    const taskId = rows[0]!.id;
    await h.pool.query(
      "INSERT INTO participations (campaign_id, user_id, task_id) VALUES ($1, $2, $3)",
      [cid, uid, taskId],
    );
    await expect(
      h.pool.query(
        "INSERT INTO participations (campaign_id, user_id, task_id) VALUES ($1, $2, $3)",
        [cid, uid, taskId],
      ),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23505");

    await expect(
      h.pool.query(
        "INSERT INTO participations (campaign_id, user_id, task_id, referrer_user_id) VALUES ($1, $2, $3, $2)",
        [cid, uid, taskId],
      ),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
  });

  it("enforces referrals uniqueness and self-referral check", async () => {
    const a = await seedUser(7003);
    const b = await seedUser(7004);
    const cid = await seedCampaign(a);
    await h.pool.query(
      "INSERT INTO referrals (campaign_id, referrer_user_id, referred_user_id, referral_code) VALUES ($1, $2, $3, 'abc')",
      [cid, a, b],
    );
    await expect(
      h.pool.query(
        "INSERT INTO referrals (campaign_id, referrer_user_id, referred_user_id, referral_code) VALUES ($1, $2, $3, 'abc')",
        [cid, a, b],
      ),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23505");
    await expect(
      h.pool.query(
        "INSERT INTO referrals (campaign_id, referrer_user_id, referred_user_id, referral_code) VALUES ($1, $2, $2, 'self')",
        [cid, a],
      ),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
  });

  it("enforces rewards.authorization_nonce UNIQUE", async () => {
    const uid = await seedUser(7005);
    const cid = await seedCampaign(uid);
    const insert = (nonce: number) =>
      h.pool.query(
        `INSERT INTO rewards
           (campaign_id, reward_type, recipient_user_id, recipient_wallet, amount_micro_usdc,
            authorization_nonce, authorization_expires_at, chain_id)
         VALUES ($1, 'USER_COMPLETION', $2, '0xabc', 100000, $3, now() + interval '1 hour', 5042002)`,
        [cid, uid, nonce],
      );
    await insert(90001);
    await expect(insert(90001)).rejects.toSatisfy((e) => pgErrorCode(e) === "23505");
  });

  it("rejects non-positive reward amounts", async () => {
    const uid = await seedUser(7006);
    await expect(
      h.pool.query(
        `INSERT INTO campaigns
           (public_id, creator_id, chain_id, reward_micro_usdc, referral_reward_micro_usdc,
            budget_micro_usdc, balance_micro_usdc)
         VALUES ('neg', $1, 5042002, 0, 0, 1000000, 0)`,
        [uid],
      ),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
  });

  it("keeps ledger_entries append-only", async () => {
    const uid = await seedUser(7007);
    const cid = await seedCampaign(uid);
    await h.pool.query(
      `INSERT INTO ledger_entries (campaign_id, entry_type, amount_micro_usdc, direction, idempotency_key)
       VALUES ($1, 'CAMPAIGN_FUNDING', 1000000, 1, 'k1')`,
      [cid],
    );
    await expect(
      h.pool.query("UPDATE ledger_entries SET amount_micro_usdc = 2 WHERE idempotency_key = 'k1'"),
    ).rejects.toThrow(/append-only/);
    await expect(
      h.pool.query("DELETE FROM ledger_entries WHERE idempotency_key = 'k1'"),
    ).rejects.toThrow(/append-only/);
  });
});
