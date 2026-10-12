# Phase 3 Campaign + Referral + Reward Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Phase 3 campaign lifecycle, participation, referral, eligibility, and reward-record engines (PRD §74) with settlement **mocked** — the full reward state machine advances through `PAID` against a mock settlement port, with no real Arc calls and no contract changes.

**Architecture:** Three new engine packages (`@spark/campaign`, `@spark/referral`, `@spark/reward`) build on existing `@spark/db` repositories and pure packages (`@spark/domain`, `@spark/rewards`, `@spark/ledger`). The worker settles `AUTHORIZED` rewards through `MockSettlement`. TDD, frequent commits.

**Tech Stack:** TypeScript 5.7 (strict), pnpm 12, Vitest 3, Drizzle ORM + drizzle-kit, Fastify 5, Zod 4, testcontainers (postgres:17).

---

**Conventions (read before starting):**
- pnpm is at `~/.local/bin/pnpm`; always run `export PATH="$HOME/.local/bin:$PATH"` first.
- Money is always `bigint` micro-USDC. Never use floats for money.
- No comments in source files.
- `exactOptionalPropertyTypes`: never pass `undefined` to an optional property — omit the key or type it `| undefined`.
- `noUncheckedIndexedAccess`: array/index access yields `T | undefined`; use `!` only where a value is guaranteed.
- Integration tests need Docker. `packages/db/test/harness.ts` starts its own `postgres:17` container; always pass a `120_000` timeout to `beforeAll`.
- Do not modify `contracts/` in this phase. Do not recreate files that already exist.

---

## File Structure Map

```
packages/db/src/schema/
  campaigns.ts        # MODIFY: add maxParticipants, participantCount + checks
  enums.ts            # MODIFY: referral_status lifecycle values
  referrals.ts        # MODIFY: status w/o default, add qualifiedAt, updatedAt
  referralCodes.ts    # CREATE: per-campaign referrer code mapping
  index.ts            # MODIFY: export referralCodes
packages/db/drizzle/  # NEW 0002_* migration (drizzle-kit generate)
packages/db/src/repositories/
  campaigns.ts        # MODIFY: findCampaignById, listCampaignsByCreator, updateCampaignStatus,
                      #         updateCampaignConfig, setCampaignFunded, reserveCampaignBudget,
                      #         incrementParticipantCount
  tasks.ts            # MODIFY: createMembershipTask
  participations.ts   # CREATE
  referrals.ts        # CREATE (attribution + lifecycle)
  referralCodes.ts    # CREATE (get-or-create + resolve)
  rewards.ts          # CREATE
  ledger.ts           # CREATE
packages/db/src/index.ts  # MODIFY barrel

packages/campaign/    # CREATE package (@spark/campaign)
packages/referral/    # CREATE package (@spark/referral)
packages/reward/      # CREATE package (@spark/reward)

worker/src/settlement/index.ts  # MODIFY: implement mock settlement loop
worker/package.json             # MODIFY: add @spark/reward

apps/api/src/routes/campaigns.ts  # CREATE
apps/api/src/routes/auth.ts       # MODIFY: referralCode attribution
apps/api/src/routes/verify.ts     # MODIFY: participation + reward authorization
apps/api/src/server.ts            # MODIFY: ApiDeps + register campaigns
apps/api/src/index.ts             # MODIFY: wire engines

apps/bot/src/message.ts           # MODIFY: referral share button
apps/telegram-mini-app/src/api.ts # MODIFY: referralCode in auth + referral-link fetch
apps/telegram-mini-app/src/main.ts# MODIFY: pass code, show status
```

---

## Task 1: DB schema changes + migration

**Files:**
- Modify: `packages/db/src/schema/campaigns.ts`
- Modify: `packages/db/src/schema/enums.ts`
- Modify: `packages/db/src/schema/referrals.ts`
- Create: `packages/db/src/schema/referralCodes.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/test/schema.test.ts`

- [ ] **Step 1: Write the failing test** — append to the `describe("schema constraints")` block in `packages/db/test/schema.test.ts`:

```ts
  it("supports phase 3 campaign + referral lifecycle columns", async () => {
    const a = await seedUser(7100);
    const b = await seedUser(7101);
    const { rows } = await h.pool.query<{ id: string }>(
      `INSERT INTO campaigns
         (public_id, creator_id, chain_id, reward_micro_usdc, referral_reward_micro_usdc,
          budget_micro_usdc, balance_micro_usdc, max_participants)
       VALUES ('p3pubid0000000001', $1, 5042002, 100000, 50000, 25000000, 0, 10) RETURNING id`,
      [a],
    );
    const cid = rows[0]!.id;
    const camp = await h.pool.query<{ participant_count: number; max_participants: number }>(
      "SELECT participant_count, max_participants FROM campaigns WHERE id = $1",
      [cid],
    );
    expect(camp.rows[0]!.participant_count).toBe(0);
    expect(camp.rows[0]!.max_participants).toBe(10);

    const ref = await h.pool.query<{ status: string }>(
      `INSERT INTO referrals (campaign_id, referrer_user_id, referred_user_id, referral_code, status)
       VALUES ($1, $2, $3, 'abc12345', 'ATTRIBUTED') RETURNING status`,
      [cid, a, b],
    );
    expect(ref.rows[0]!.status).toBe("ATTRIBUTED");

    const code = await h.pool.query<{ code: string }>(
      `INSERT INTO referral_codes (campaign_id, referrer_user_id, code)
       VALUES ($1, $2, 'code0001') RETURNING code`,
      [cid, a],
    );
    expect(code.rows[0]!.code).toBe("code0001");
    await expect(
      h.pool.query(
        `INSERT INTO referral_codes (campaign_id, referrer_user_id, code)
         VALUES ($1, $3, 'code0002')`,
        [cid, a, b],
      ),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23505");
  });

  it("rejects participant_count over max_participants", async () => {
    const uid = await seedUser(7102);
    await expect(
      h.pool.query(
        `INSERT INTO campaigns
           (public_id, creator_id, chain_id, reward_micro_usdc, referral_reward_micro_usdc,
            budget_micro_usdc, balance_micro_usdc, max_participants, participant_count)
         VALUES ('p3pubid0000000002', $1, 5042002, 100000, 0, 25000000, 0, 1, 2)`,
        [uid],
      ),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
  });
```

- [ ] **Step 2: Update the two existing referral inserts in `schema.test.ts`** (they currently rely on the old `PENDING` default, which is being removed). In the `enforces referrals uniqueness and self-referral check` test, add `, status` and a value to both inserts:

```ts
    await h.pool.query(
      "INSERT INTO referrals (campaign_id, referrer_user_id, referred_user_id, referral_code, status) VALUES ($1, $2, $3, 'abc', 'ATTRIBUTED')",
      [cid, a, b],
    );
    await expect(
      h.pool.query(
        "INSERT INTO referrals (campaign_id, referrer_user_id, referred_user_id, referral_code, status) VALUES ($1, $2, $3, 'abc', 'ATTRIBUTED')",
        [cid, a, b],
      ),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23505");
    await expect(
      h.pool.query(
        "INSERT INTO referrals (campaign_id, referrer_user_id, referred_user_id, referral_code, status) VALUES ($1, $2, $2, 'self', 'ATTRIBUTED')",
        [cid, a],
      ),
    ).rejects.toSatisfy((e) => pgErrorCode(e) === "23514");
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test -- schema`
Expected: FAIL — `max_participants` / `referral_codes` / `ATTRIBUTED` missing.

- [ ] **Step 4: Update campaigns schema** — in `packages/db/src/schema/campaigns.ts`, add columns after `targetChatUsername`:

```ts
    maxParticipants: integer("max_participants"),
    participantCount: integer("participant_count").notNull().default(0),
```

and add to the constraints array:

```ts
    check("campaigns_participant_count_non_negative", sql`${t.participantCount} >= 0`),
    check(
      "campaigns_participant_count_within_max",
      sql`${t.maxParticipants} IS NULL OR ${t.participantCount} <= ${t.maxParticipants}`,
    ),
```

- [ ] **Step 5: Update the referral enum** — in `packages/db/src/schema/enums.ts`, replace `referralStatus`:

```ts
export const referralStatus = pgEnum("referral_status", [
  "ATTRIBUTED",
  "QUALIFIED",
  "REWARD_PENDING",
  "PAID",
  "REJECTED",
]);
```

- [ ] **Step 6: Update referrals schema** — in `packages/db/src/schema/referrals.ts`, remove the `status` default and add two columns:

```ts
    status: referralStatus("status").notNull(),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 7: Create `packages/db/src/schema/referralCodes.ts`:**

```ts
import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";
import { users } from "./users";

export const referralCodes = pgTable(
  "referral_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    referrerUserId: uuid("referrer_user_id")
      .notNull()
      .references(() => users.id),
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("referral_codes_campaign_code_unique").on(t.campaignId, t.code),
    unique("referral_codes_campaign_referrer_unique").on(t.campaignId, t.referrerUserId),
  ],
);

export type ReferralCodeRow = typeof referralCodes.$inferSelect;
export type NewReferralCodeRow = typeof referralCodes.$inferInsert;
```

- [ ] **Step 8: Export the new schema** — check `packages/db/src/schema/index.ts` and ensure it re-exports every schema module; add `export * from "./referralCodes";` if the file uses explicit exports. (If it uses `export *` from each file, add the line consistently.)

- [ ] **Step 9: Generate the migration**

Run: `export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @spark/db db:generate`
Expected: `packages/db/drizzle/0002_*.sql` created. Open it and confirm it contains:
- `ALTER TYPE "public"."referral_status" ADD VALUE` for `ATTRIBUTED`, `QUALIFIED`, `REWARD_PENDING`, `PAID`
- `ALTER TABLE "campaigns" ADD COLUMN "max_participants"` / `"participant_count"`
- `ALTER TABLE "referrals" ADD COLUMN "qualified_at"` / `"updated_at"` and `ALTER COLUMN "status" DROP DEFAULT`
- `CREATE TABLE "referral_codes"`
If drizzle-kit emits a statement that *uses* a new enum value as a default in the same file, delete only that statement. Then append a sequence used for reward authorization nonces:

```sql
CREATE SEQUENCE IF NOT EXISTS "reward_nonce_seq" START WITH 1000000;--> statement-breakpoint
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test -- schema`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/db/src/schema packages/db/drizzle packages/db/test/schema.test.ts
git commit -m "feat(db): phase 3 campaign + referral schema, codes, and migration"
```

---

## Task 2: DB repositories — campaigns + tasks

**Files:**
- Modify: `packages/db/src/repositories/campaigns.ts`
- Modify: `packages/db/src/repositories/tasks.ts`
- Test: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write the failing test** — append to `describe("repositories")`:

```ts
  it("drives campaign lifecycle and reserves budget atomically", async () => {
    const {
      createCampaign,
      findCampaignById,
      setCampaignFunded,
      updateCampaignStatus,
      reserveCampaignBudget,
      updateCampaignConfig,
      incrementParticipantCount,
    } = await import("../src");
    const creator = await upsertUserByTelegramId(h.db, { telegramUserId: 8100n });
    const c = await createCampaign(h.db, {
      publicId: "publife00000000001",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
      maxParticipants: 5,
    });
    expect((await findCampaignById(h.db, c.id))?.status).toBe("DRAFT");

    const configured = await updateCampaignConfig(h.db, c.id, { rewardMicroUsdc: 120_000n });
    expect(configured.rewardMicroUsdc).toBe(120_000n);

    await updateCampaignStatus(h.db, c.id, "FUNDING");
    await setCampaignFunded(h.db, c.id, 1_000_000n);
    expect((await findCampaignById(h.db, c.id))?.balanceMicroUsdc).toBe(1_000_000n);

    expect(await reserveCampaignBudget(h.db, c.id, 100_000n)).toBe(true);
    expect((await findCampaignById(h.db, c.id))?.balanceMicroUsdc).toBe(900_000n);
    expect(await reserveCampaignBudget(h.db, c.id, 10_000_000n)).toBe(false);
    expect((await findCampaignById(h.db, c.id))?.balanceMicroUsdc).toBe(900_000n);

    expect(await incrementParticipantCount(h.db, c.id)).toBe(true);
    expect((await findCampaignById(h.db, c.id))?.participantCount).toBe(1);
  });

  it("creates a membership task and finds it", async () => {
    const { createCampaign, createMembershipTask, findMembershipTask } = await import("../src");
    const creator = await upsertUserByTelegramId(h.db, { telegramUserId: 8101n });
    const c = await createCampaign(h.db, {
      publicId: "pubtask00000000001",
      creatorId: creator.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });
    await createMembershipTask(h.db, {
      campaignId: c.id,
      rewardMicroUsdc: 100_000n,
      chatId: "-100999",
    });
    const task = await findMembershipTask(h.db, c.id);
    expect(task?.rewardMicroUsdc).toBe(100_000n);
    expect((task?.config as { chat_id?: string }).chat_id).toBe("-100999");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test -- repositories`
Expected: FAIL — new functions not exported.

- [ ] **Step 3: Implement** — replace `packages/db/src/repositories/campaigns.ts` with:

```ts
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { type CampaignRow, campaigns, type NewCampaignRow } from "../schema";

export async function createCampaign(db: Db, input: NewCampaignRow): Promise<CampaignRow> {
  const [row] = await db.insert(campaigns).values(input).returning();
  return row!;
}

export async function findCampaignByPublicId(
  db: Db,
  publicId: string,
): Promise<CampaignRow | null> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.publicId, publicId)).limit(1);
  return row ?? null;
}

export async function findCampaignById(db: Db, id: string): Promise<CampaignRow | null> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return row ?? null;
}

export async function listCampaignsByCreator(db: Db, creatorId: string): Promise<CampaignRow[]> {
  return db.select().from(campaigns).where(eq(campaigns.creatorId, creatorId));
}

export async function updateCampaignStatus(
  db: Db,
  id: string,
  status: CampaignRow["status"],
  extra: Partial<Pick<CampaignRow, "activatedAt" | "closedAt">> = {},
): Promise<CampaignRow> {
  const [row] = await db
    .update(campaigns)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(campaigns.id, id))
    .returning();
  return row!;
}

export async function updateCampaignConfig(
  db: Db,
  id: string,
  patch: Partial<CampaignRow>,
): Promise<CampaignRow> {
  const [row] = await db
    .update(campaigns)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(campaigns.id, id))
    .returning();
  return row!;
}

export async function setCampaignFunded(
  db: Db,
  id: string,
  amountMicroUsdc: bigint,
): Promise<CampaignRow> {
  const [row] = await db
    .update(campaigns)
    .set({ balanceMicroUsdc: amountMicroUsdc, status: "FUNDED", updatedAt: new Date() })
    .where(eq(campaigns.id, id))
    .returning();
  return row!;
}

export async function reserveCampaignBudget(
  db: Db,
  campaignId: string,
  amountMicroUsdc: bigint,
): Promise<boolean> {
  const rows = await db
    .update(campaigns)
    .set({
      balanceMicroUsdc: sql`${campaigns.balanceMicroUsdc} - ${amountMicroUsdc}`,
      updatedAt: new Date(),
    })
    .where(and(eq(campaigns.id, campaignId), gte(campaigns.balanceMicroUsdc, amountMicroUsdc)))
    .returning({ id: campaigns.id });
  return rows.length === 1;
}

export async function incrementParticipantCount(db: Db, campaignId: string): Promise<boolean> {
  const rows = await db
    .update(campaigns)
    .set({
      participantCount: sql`${campaigns.participantCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(campaigns.id, campaignId),
        sql`(${campaigns.maxParticipants} IS NULL OR ${campaigns.participantCount} < ${campaigns.maxParticipants})`,
      ),
    )
    .returning({ id: campaigns.id });
  return rows.length === 1;
}
```

- [ ] **Step 4: Implement tasks** — replace `packages/db/src/repositories/tasks.ts` with:

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type NewTaskRow, type TaskRow, tasks } from "../schema";

export async function createMembershipTask(
  db: Db,
  input: { campaignId: string; rewardMicroUsdc: bigint; chatId: string },
): Promise<TaskRow> {
  const values: NewTaskRow = {
    campaignId: input.campaignId,
    type: "TELEGRAM_CHANNEL_MEMBERSHIP",
    rewardMicroUsdc: input.rewardMicroUsdc,
    config: { chat_id: input.chatId },
  };
  const [row] = await db.insert(tasks).values(values).returning();
  return row!;
}

export async function findMembershipTask(db: Db, campaignId: string): Promise<TaskRow | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.campaignId, campaignId), eq(tasks.type, "TELEGRAM_CHANNEL_MEMBERSHIP")))
    .limit(1);
  return row ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test -- repositories`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repositories/campaigns.ts packages/db/src/repositories/tasks.ts packages/db/test/repositories.test.ts
git commit -m "feat(db): campaign lifecycle and task repositories"
```

---

## Task 3: DB repository — participations

**Files:**
- Create: `packages/db/src/repositories/participations.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write the failing test** — append to `describe("repositories")`:

```ts
  it("creates a participation, freezes the referrer, and advances status", async () => {
    const {
      createCampaign,
      createMembershipTask,
      createParticipation,
      findParticipation,
      updateParticipationStatus,
      setParticipationReferrer,
    } = await import("../src");
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8200n });
    const b = await upsertUserByTelegramId(h.db, { telegramUserId: 8201n });
    const c = await createCampaign(h.db, {
      publicId: "pubpart00000000001",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });
    const task = await createMembershipTask(h.db, {
      campaignId: c.id,
      rewardMicroUsdc: 100_000n,
      chatId: "-1001",
    });
    const p = await createParticipation(h.db, { campaignId: c.id, userId: b.id, taskId: task.id });
    expect(p.status).toBe("STARTED");

    await setParticipationReferrer(h.db, p.id, { referrerUserId: a.id, referralCode: "abc12345" });
    const found = await findParticipation(h.db, c.id, b.id);
    expect(found?.referrerUserId).toBe(a.id);
    expect(found?.referralCodeUsed).toBe("abc12345");

    const verified = await updateParticipationStatus(h.db, p.id, "VERIFIED", { verifiedAt: new Date() });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedAt).not.toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test -- repositories`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** — create `packages/db/src/repositories/participations.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type ParticipationRow, participations } from "../schema";

export async function createParticipation(
  db: Db,
  input: { campaignId: string; userId: string; taskId: string },
): Promise<ParticipationRow> {
  const [row] = await db.insert(participations).values(input).returning();
  return row!;
}

export async function findParticipation(
  db: Db,
  campaignId: string,
  userId: string,
): Promise<ParticipationRow | null> {
  const [row] = await db
    .select()
    .from(participations)
    .where(and(eq(participations.campaignId, campaignId), eq(participations.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function findParticipationById(
  db: Db,
  id: string,
): Promise<ParticipationRow | null> {
  const [row] = await db.select().from(participations).where(eq(participations.id, id)).limit(1);
  return row ?? null;
}

export async function setParticipationReferrer(
  db: Db,
  id: string,
  input: { referrerUserId: string; referralCode: string },
): Promise<ParticipationRow> {
  const [row] = await db
    .update(participations)
    .set({
      referrerUserId: input.referrerUserId,
      referralCodeUsed: input.referralCode,
      updatedAt: new Date(),
    })
    .where(eq(participations.id, id))
    .returning();
  return row!;
}

export async function updateParticipationStatus(
  db: Db,
  id: string,
  status: ParticipationRow["status"],
  extra: Partial<Pick<ParticipationRow, "verifiedAt" | "rewardId">> = {},
): Promise<ParticipationRow> {
  const [row] = await db
    .update(participations)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(participations.id, id))
    .returning();
  return row!;
}
```

- [ ] **Step 4: Export** — add to `packages/db/src/index.ts`:

```ts
export * from "./repositories/participations";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test -- repositories`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repositories/participations.ts packages/db/src/index.ts packages/db/test/repositories.test.ts
git commit -m "feat(db): participation repository"
```

---

## Task 4: DB repositories — referrals + referral codes

**Files:**
- Create: `packages/db/src/repositories/referrals.ts`
- Create: `packages/db/src/repositories/referralCodes.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write the failing test** — append to `describe("repositories")`:

```ts
  it("attributes referrals first-wins and advances lifecycle", async () => {
    const { createCampaign, upsertReferralAttribution, findReferral, updateReferralStatus } =
      await import("../src");
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8300n });
    const b = await upsertUserByTelegramId(h.db, { telegramUserId: 8301n });
    const c = await createCampaign(h.db, {
      publicId: "pubref000000000001",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });
    const first = await upsertReferralAttribution(h.db, {
      campaignId: c.id,
      referrerUserId: a.id,
      referredUserId: b.id,
      referralCode: "code0001",
    });
    expect(first?.status).toBe("ATTRIBUTED");

    const again = await upsertReferralAttribution(h.db, {
      campaignId: c.id,
      referrerUserId: a.id,
      referredUserId: b.id,
      referralCode: "code0001",
    });
    expect(again?.id).toBe(first?.id);

    const qualified = await updateReferralStatus(h.db, first!.id, "QUALIFIED", {
      qualifiedAt: new Date(),
    });
    expect(qualified.status).toBe("QUALIFIED");
    expect((await findReferral(h.db, c.id, b.id))?.qualifiedAt).not.toBeNull();
  });

  it("returns null for self-referral", async () => {
    const { createCampaign, upsertReferralAttribution } = await import("../src");
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8302n });
    const c = await createCampaign(h.db, {
      publicId: "pubref000000000002",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });
    expect(
      await upsertReferralAttribution(h.db, {
        campaignId: c.id,
        referrerUserId: a.id,
        referredUserId: a.id,
        referralCode: "self0001",
      }),
    ).toBeNull();
  });

  it("issues one referral code per referrer and resolves referrer by code", async () => {
    const { createCampaign, getOrCreateReferralCode, findReferrerByCode } = await import("../src");
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8303n });
    const c = await createCampaign(h.db, {
      publicId: "pubref000000000003",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 0n,
    });
    const code1 = await getOrCreateReferralCode(h.db, {
      campaignId: c.id,
      referrerUserId: a.id,
      generate: () => "code0007",
    });
    const code2 = await getOrCreateReferralCode(h.db, {
      campaignId: c.id,
      referrerUserId: a.id,
      generate: () => "code9999",
    });
    expect(code2).toBe(code1);
    expect(code1).toBe("code0007");
    expect((await findReferrerByCode(h.db, c.id, "code0007"))?.id).toBe(a.id);
    expect(await findReferrerByCode(h.db, c.id, "nope1234")).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test -- repositories`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement `referrals.ts`:**

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type ReferralRow, referrals } from "../schema";

export async function upsertReferralAttribution(
  db: Db,
  input: {
    campaignId: string;
    referrerUserId: string;
    referredUserId: string;
    referralCode: string;
  },
): Promise<ReferralRow | null> {
  if (input.referrerUserId === input.referredUserId) return null;
  await db
    .insert(referrals)
    .values({
      campaignId: input.campaignId,
      referrerUserId: input.referrerUserId,
      referredUserId: input.referredUserId,
      referralCode: input.referralCode,
      status: "ATTRIBUTED",
    })
    .onConflictDoNothing();
  return findReferral(db, input.campaignId, input.referredUserId);
}

export async function findReferral(
  db: Db,
  campaignId: string,
  referredUserId: string,
): Promise<ReferralRow | null> {
  const [row] = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.campaignId, campaignId), eq(referrals.referredUserId, referredUserId)))
    .limit(1);
  return row ?? null;
}

export async function updateReferralStatus(
  db: Db,
  id: string,
  status: ReferralRow["status"],
  extra: Partial<Pick<ReferralRow, "qualifiedAt">> = {},
): Promise<ReferralRow> {
  const [row] = await db
    .update(referrals)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(referrals.id, id))
    .returning();
  return row!;
}

export async function countReferralsByStatus(
  db: Db,
  campaignId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: referrals.status })
    .from(referrals)
    .where(eq(referrals.campaignId, campaignId));
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}
```

- [ ] **Step 4: Implement `referralCodes.ts`:**

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type ReferralCodeRow, referralCodes } from "../schema";
import { users } from "../schema";

export async function getOrCreateReferralCode(
  db: Db,
  input: { campaignId: string; referrerUserId: string; generate: () => string },
): Promise<string> {
  const existing = await db
    .select()
    .from(referralCodes)
    .where(
      and(
        eq(referralCodes.campaignId, input.campaignId),
        eq(referralCodes.referrerUserId, input.referrerUserId),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].code;

  const code = input.generate();
  await db
    .insert(referralCodes)
    .values({
      campaignId: input.campaignId,
      referrerUserId: input.referrerUserId,
      code,
    })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(referralCodes)
    .where(
      and(
        eq(referralCodes.campaignId, input.campaignId),
        eq(referralCodes.referrerUserId, input.referrerUserId),
      ),
    )
    .limit(1);
  return row!.code;
}

export async function findReferrerByCode(
  db: Db,
  campaignId: string,
  code: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(referralCodes)
    .innerJoin(users, eq(users.id, referralCodes.referrerUserId))
    .where(and(eq(referralCodes.campaignId, campaignId), eq(referralCodes.code, code)))
    .limit(1);
  return row ?? null;
}
```

- [ ] **Step 5: Export** — add to `packages/db/src/index.ts`:

```ts
export * from "./repositories/referralCodes";
export * from "./repositories/referrals";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test -- repositories && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repositories/referrals.ts packages/db/src/repositories/referralCodes.ts packages/db/src/index.ts packages/db/test/repositories.test.ts
git commit -m "feat(db): referral attribution and referral-code repositories"
```

---

## Task 5: DB repository — rewards

**Files:**
- Create: `packages/db/src/repositories/rewards.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write the failing test** — append to `describe("repositories")`:

```ts
  it("creates rewards, lists settleable ones, and advances status", async () => {
    const {
      createCampaign,
      createMembershipTask,
      createParticipation,
      createReward,
      listSettleableRewards,
      updateRewardStatus,
      nextRewardNonce,
      findRewardByType,
    } = await import("../src");
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8400n });
    const c = await createCampaign(h.db, {
      publicId: "pubrw000000000001",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
    });
    const task = await createMembershipTask(h.db, {
      campaignId: c.id,
      rewardMicroUsdc: 100_000n,
      chatId: "-1002",
    });
    const p = await createParticipation(h.db, { campaignId: c.id, userId: a.id, taskId: task.id });

    const nonce = await nextRewardNonce(h.db);
    const reward = await createReward(h.db, {
      campaignId: c.id,
      participationId: p.id,
      rewardType: "USER_COMPLETION",
      recipientUserId: a.id,
      recipientWallet: "0xabc",
      amountMicroUsdc: 100_000n,
      authorizationNonce: nonce,
      authorizationExpiresAt: new Date(Date.now() + 3_600_000),
      chainId: 5042002,
    });
    expect(reward.status).toBe("AUTHORIZED");
    expect((await findRewardByType(h.db, c.id, p.id, "USER_COMPLETION"))?.id).toBe(reward.id);

    expect((await listSettleableRewards(h.db, 10)).map((r) => r.id)).toContain(reward.id);
    const paid = await updateRewardStatus(h.db, reward.id, "PAID", { confirmedAt: new Date() });
    expect(paid.status).toBe("PAID");
    expect((await listSettleableRewards(h.db, 10)).map((r) => r.id)).not.toContain(reward.id);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test -- repositories`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** — create `packages/db/src/repositories/rewards.ts`:

```ts
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import { type NewRewardRow, type RewardRow, rewards } from "../schema";

export async function nextRewardNonce(db: Db): Promise<bigint> {
  const result = await db.execute<{ nextval: string }>(
    sql`SELECT nextval('reward_nonce_seq') AS nextval`,
  );
  return BigInt(result.rows[0]!.nextval);
}

export async function createReward(db: Db, input: NewRewardRow): Promise<RewardRow> {
  const [row] = await db.insert(rewards).values(input).returning();
  return row!;
}

export async function findRewardById(db: Db, id: string): Promise<RewardRow | null> {
  const [row] = await db.select().from(rewards).where(eq(rewards.id, id)).limit(1);
  return row ?? null;
}

export async function findRewardByType(
  db: Db,
  campaignId: string,
  participationId: string,
  rewardType: RewardRow["rewardType"],
): Promise<RewardRow | null> {
  const [row] = await db
    .select()
    .from(rewards)
    .where(
      and(
        eq(rewards.campaignId, campaignId),
        eq(rewards.participationId, participationId),
        eq(rewards.rewardType, rewardType),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listSettleableRewards(db: Db, limit: number): Promise<RewardRow[]> {
  return db
    .select()
    .from(rewards)
    .where(
      and(
        inArray(rewards.status, ["AUTHORIZED", "RETRYING"]),
        gt(rewards.authorizationExpiresAt, new Date()),
      ),
    )
    .orderBy(asc(rewards.createdAt))
    .limit(limit);
}

export async function updateRewardStatus(
  db: Db,
  id: string,
  status: RewardRow["status"],
  extra: Partial<
    Pick<RewardRow, "transactionHash" | "submittedAt" | "confirmedAt" | "failedAt">
  > = {},
): Promise<RewardRow> {
  const [row] = await db
    .update(rewards)
    .set({ status, ...extra })
    .where(eq(rewards.id, id))
    .returning();
  return row!;
}

export async function countRewardsByStatus(
  db: Db,
  campaignId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: rewards.status })
    .from(rewards)
    .where(eq(rewards.campaignId, campaignId));
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}
```

- [ ] **Step 4: Export** — add to `packages/db/src/index.ts`:

```ts
export * from "./repositories/rewards";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test -- repositories && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repositories/rewards.ts packages/db/src/index.ts packages/db/test/repositories.test.ts
git commit -m "feat(db): reward repository"
```

---

## Task 6: DB repository — ledger

**Files:**
- Create: `packages/db/src/repositories/ledger.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write the failing test** — append to `describe("repositories")`:

```ts
  it("appends ledger entries idempotently", async () => {
    const { createCampaign, appendLedgerEntry, findLedgerEntryByIdempotencyKey } = await import(
      "../src"
    );
    const a = await upsertUserByTelegramId(h.db, { telegramUserId: 8500n });
    const c = await createCampaign(h.db, {
      publicId: "publ3d000000000001",
      creatorId: a.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
    });
    await appendLedgerEntry(h.db, {
      campaignId: c.id,
      entryType: "CAMPAIGN_FUNDING",
      amountMicroUsdc: 1_000_000n,
      direction: 1,
      idempotencyKey: `funding:${c.id}`,
    });
    await appendLedgerEntry(h.db, {
      campaignId: c.id,
      entryType: "CAMPAIGN_FUNDING",
      amountMicroUsdc: 1_000_000n,
      direction: 1,
      idempotencyKey: `funding:${c.id}`,
    });
    const row = await findLedgerEntryByIdempotencyKey(h.db, `funding:${c.id}`);
    expect(row?.amountMicroUsdc).toBe(1_000_000n);
    expect(row?.direction).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test -- repositories`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** — create `packages/db/src/repositories/ledger.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { type LedgerEntryRow, ledgerEntries, type NewLedgerEntryRow } from "../schema";

export async function appendLedgerEntry(
  db: Db,
  input: {
    campaignId: string;
    rewardId?: string | null;
    entryType: LedgerEntryRow["entryType"];
    amountMicroUsdc: bigint;
    direction: 1 | -1;
    idempotencyKey: string;
    reference?: string | null;
  },
): Promise<LedgerEntryRow> {
  const values: NewLedgerEntryRow = {
    campaignId: input.campaignId,
    rewardId: input.rewardId ?? null,
    entryType: input.entryType,
    amountMicroUsdc: input.amountMicroUsdc,
    direction: input.direction,
    idempotencyKey: input.idempotencyKey,
    reference: input.reference ?? null,
  };
  const [row] = await db.insert(ledgerEntries).values(values).onConflictDoNothing().returning();
  if (row) return row;
  return (await findLedgerEntryByIdempotencyKey(db, input.idempotencyKey))!;
}

export async function findLedgerEntryByIdempotencyKey(
  db: Db,
  idempotencyKey: string,
): Promise<LedgerEntryRow | null> {
  const [row] = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.idempotencyKey, idempotencyKey))
    .limit(1);
  return row ?? null;
}

export async function listLedgerEntriesByCampaign(
  db: Db,
  campaignId: string,
): Promise<LedgerEntryRow[]> {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.campaignId, campaignId));
}
```

- [ ] **Step 4: Export** — add to `packages/db/src/index.ts`:

```ts
export * from "./repositories/ledger";
```

- [ ] **Step 5: Run the full db suite + typecheck**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/db && pnpm test && pnpm typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repositories/ledger.ts packages/db/src/index.ts packages/db/test/repositories.test.ts
git commit -m "feat(db): ledger repository"
```

---

## Task 7: @spark/campaign package + engine (create/config)

**Files:**
- Create: `packages/campaign/package.json`, `packages/campaign/tsconfig.json`
- Create: `packages/campaign/src/state.ts`, `packages/campaign/src/engine.ts`, `packages/campaign/src/index.ts`
- Test: `packages/campaign/test/engine.test.ts`

- [ ] **Step 1: Scaffold.** Create `packages/campaign/package.json`:

```json
{
  "name": "@spark/campaign",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@spark/db": "workspace:*",
    "@spark/domain": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  }
}
```

Create `packages/campaign/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

Run: `export PATH="$HOME/.local/bin:$PATH" && pnpm install`

- [ ] **Step 2: Write the failing test.** Create `packages/campaign/test/engine.test.ts`:

```ts
import { type Db, findCampaignById, findMembershipTask, updateCampaignStatus, upsertUserByTelegramId } from "@spark/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../db/test/harness";
import { createCampaignEngine } from "../src";
import { canTransitionCampaign } from "../src/state";

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

async function creator(telegramId: number): Promise<string> {
  return (await upsertUserByTelegramId(db, { telegramUserId: BigInt(telegramId) })).id;
}

describe("campaign state machine", () => {
  it("allows the canonical lifecycle only", () => {
    expect(canTransitionCampaign("DRAFT", "FUNDING")).toBe(true);
    expect(canTransitionCampaign("FUNDING", "FUNDED")).toBe(true);
    expect(canTransitionCampaign("FUNDED", "ACTIVE")).toBe(true);
    expect(canTransitionCampaign("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransitionCampaign("PAUSED", "ACTIVE")).toBe(true);
    expect(canTransitionCampaign("ACTIVE", "CLOSED")).toBe(true);
    expect(canTransitionCampaign("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransitionCampaign("CLOSED", "ACTIVE")).toBe(false);
  });
});

describe("CampaignEngine create", () => {
  it("creates a DRAFT campaign with a membership task", async () => {
    const engine = createCampaignEngine({ db });
    const created = await engine.createCampaign({
      creatorId: await creator(9001),
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      maxParticipants: 10,
      targetChatId: -1001234567890n,
    });
    expect(created.status).toBe("DRAFT");
    expect(created.publicId).toMatch(/^[0-9a-z]{16}$/);
    expect(created.maxParticipants).toBe(10);
    const task = await findMembershipTask(db, created.id);
    expect((task?.config as { chat_id?: string }).chat_id).toBe("-1001234567890");
  });

  it("rejects config updates after leaving DRAFT", async () => {
    const engine = createCampaignEngine({ db });
    const created = await engine.createCampaign({
      creatorId: await creator(9002),
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
    });
    await updateCampaignStatus(db, created.id, "FUNDING");
    await expect(engine.updateConfig(created.id, { rewardMicroUsdc: 200_000n })).rejects.toThrow(
      /not draft/i,
    );
    expect((await findCampaignById(db, created.id))?.rewardMicroUsdc).toBe(100_000n);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/campaign && pnpm test`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `state.ts`:**

```ts
export const CAMPAIGN_STATES = [
  "DRAFT",
  "FUNDING",
  "FUNDED",
  "ACTIVE",
  "PAUSED",
  "CLOSED",
  "FUNDING_FAILED",
] as const;

export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export const CAMPAIGN_TRANSITIONS: Record<CampaignState, readonly CampaignState[]> = {
  DRAFT: ["FUNDING"],
  FUNDING: ["FUNDED", "FUNDING_FAILED"],
  FUNDED: ["ACTIVE", "FUNDING_FAILED"],
  ACTIVE: ["PAUSED", "CLOSED", "FUNDING_FAILED"],
  PAUSED: ["ACTIVE", "CLOSED"],
  CLOSED: [],
  FUNDING_FAILED: [],
};

export function canTransitionCampaign(from: CampaignState, to: CampaignState): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

export function assertCampaignTransition(from: CampaignState, to: CampaignState): void {
  if (!canTransitionCampaign(from, to)) {
    throw new CampaignError(`invalid campaign transition: ${from} -> ${to}`);
  }
}

export class CampaignError extends Error {
  override readonly name = "CampaignError";
}
```

- [ ] **Step 5: Implement `engine.ts`:**

```ts
import {
  type CampaignRow,
  createCampaign as insertCampaign,
  createMembershipTask,
  type Db,
  findCampaignById,
  setCampaignFunded,
  updateCampaignConfig,
  updateCampaignStatus,
} from "@spark/db";
import { generatePublicId } from "@spark/domain";
import { assertCampaignTransition, type CampaignState, CampaignError } from "./state";

export interface CreateCampaignInput {
  creatorId: string;
  chainId: number;
  rewardMicroUsdc: bigint;
  referralRewardMicroUsdc: bigint;
  budgetMicroUsdc: bigint;
  maxParticipants?: number;
  targetChatId?: bigint;
  targetChatUsername?: string;
}

export interface CampaignConfigInput {
  rewardMicroUsdc?: bigint;
  referralRewardMicroUsdc?: bigint;
  budgetMicroUsdc?: bigint;
  maxParticipants?: number | null;
  targetChatId?: bigint;
  targetChatUsername?: string;
}

export interface CampaignStats {
  participantCount: number;
  maxParticipants: number | null;
  balanceMicroUsdc: bigint;
  budgetMicroUsdc: bigint;
}

export interface CampaignEngine {
  createCampaign(input: CreateCampaignInput): Promise<CampaignRow>;
  updateConfig(campaignId: string, input: CampaignConfigInput): Promise<CampaignRow>;
  fundCampaign(campaignId: string, amountMicroUsdc: bigint): Promise<CampaignRow>;
  activateCampaign(campaignId: string): Promise<CampaignRow>;
  pauseCampaign(campaignId: string): Promise<CampaignRow>;
  resumeCampaign(campaignId: string): Promise<CampaignRow>;
  closeCampaign(campaignId: string): Promise<CampaignRow>;
  getCampaignStats(campaignId: string): Promise<CampaignStats>;
}

export function requiredMinimum(campaign: CampaignRow): bigint {
  if (campaign.maxParticipants === null) return campaign.budgetMicroUsdc;
  const perUser = campaign.rewardMicroUsdc + campaign.referralRewardMicroUsdc;
  return perUser * BigInt(campaign.maxParticipants);
}

export function createCampaignEngine(deps: { db: Db }): CampaignEngine {
  const { db } = deps;

  async function load(campaignId: string): Promise<CampaignRow> {
    const campaign = await findCampaignById(db, campaignId);
    if (!campaign) throw new CampaignError("campaign not found");
    return campaign;
  }

  async function transition(campaignId: string, to: CampaignState): Promise<CampaignRow> {
    const campaign = await load(campaignId);
    assertCampaignTransition(campaign.status as CampaignState, to);
    const extra: { activatedAt?: Date; closedAt?: Date } = {};
    if (to === "ACTIVE") extra.activatedAt = new Date();
    if (to === "CLOSED") extra.closedAt = new Date();
    return updateCampaignStatus(db, campaignId, to, extra);
  }

  return {
    async createCampaign(input) {
      if (input.rewardMicroUsdc <= 0n) throw new CampaignError("reward must be positive");
      if (input.budgetMicroUsdc <= 0n) throw new CampaignError("budget must be positive");
      if (input.rewardMicroUsdc > input.budgetMicroUsdc) {
        throw new CampaignError("reward exceeds budget");
      }
      if (input.maxParticipants !== undefined && input.maxParticipants <= 0) {
        throw new CampaignError("maxParticipants must be positive");
      }
      const created = await insertCampaign(db, {
        publicId: generatePublicId(),
        creatorId: input.creatorId,
        chainId: input.chainId,
        rewardMicroUsdc: input.rewardMicroUsdc,
        referralRewardMicroUsdc: input.referralRewardMicroUsdc,
        budgetMicroUsdc: input.budgetMicroUsdc,
        balanceMicroUsdc: 0n,
        maxParticipants: input.maxParticipants ?? null,
        targetChatId: input.targetChatId ?? null,
        targetChatUsername: input.targetChatUsername ?? null,
        status: "DRAFT",
      });
      if (input.targetChatId !== undefined) {
        await createMembershipTask(db, {
          campaignId: created.id,
          rewardMicroUsdc: input.rewardMicroUsdc,
          chatId: input.targetChatId.toString(),
        });
      }
      return created;
    },

    async updateConfig(campaignId, input) {
      const campaign = await load(campaignId);
      if (campaign.status !== "DRAFT") throw new CampaignError("campaign is not draft");
      const patch: Partial<CampaignRow> = {};
      if (input.rewardMicroUsdc !== undefined) patch.rewardMicroUsdc = input.rewardMicroUsdc;
      if (input.referralRewardMicroUsdc !== undefined) {
        patch.referralRewardMicroUsdc = input.referralRewardMicroUsdc;
      }
      if (input.budgetMicroUsdc !== undefined) patch.budgetMicroUsdc = input.budgetMicroUsdc;
      if (input.maxParticipants !== undefined) patch.maxParticipants = input.maxParticipants;
      if (input.targetChatId !== undefined) patch.targetChatId = input.targetChatId;
      if (input.targetChatUsername !== undefined) {
        patch.targetChatUsername = input.targetChatUsername;
      }
      return updateCampaignConfig(db, campaignId, patch);
    },

    async fundCampaign(campaignId, amountMicroUsdc) {
      const campaign = await load(campaignId);
      assertCampaignTransition(campaign.status as CampaignState, "FUNDED");
      if (amountMicroUsdc < requiredMinimum(campaign)) {
        throw new CampaignError("insufficient funding");
      }
      await updateCampaignStatus(db, campaignId, "FUNDING");
      return setCampaignFunded(db, campaignId, amountMicroUsdc);
    },

    async activateCampaign(campaignId) {
      const campaign = await load(campaignId);
      if (campaign.balanceMicroUsdc < requiredMinimum(campaign)) {
        throw new CampaignError("campaign not funded enough");
      }
      return transition(campaignId, "ACTIVE");
    },

    pauseCampaign: (campaignId) => transition(campaignId, "PAUSED"),
    resumeCampaign: (campaignId) => transition(campaignId, "ACTIVE"),
    closeCampaign: (campaignId) => transition(campaignId, "CLOSED"),

    async getCampaignStats(campaignId) {
      const campaign = await load(campaignId);
      return {
        participantCount: campaign.participantCount,
        maxParticipants: campaign.maxParticipants,
        balanceMicroUsdc: campaign.balanceMicroUsdc,
        budgetMicroUsdc: campaign.budgetMicroUsdc,
      };
    },
  };
}
```

- [ ] **Step 6: Implement `index.ts`:**

```ts
export * from "./engine";
export * from "./state";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/campaign && pnpm test && pnpm typecheck`
Expected: PASS + no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/campaign pnpm-lock.yaml
git commit -m "feat(campaign): campaign engine create + config + state machine"
```

---

## Task 8: @spark/campaign — lifecycle coverage

**Files:**
- Test: `packages/campaign/test/engine.test.ts`

- [ ] **Step 1: Write the failing test** — append a new `describe`:

```ts
describe("CampaignEngine lifecycle", () => {
  it("funds, activates, pauses, resumes, and closes with threshold checks", async () => {
    const engine = createCampaignEngine({ db });
    const created = await engine.createCampaign({
      creatorId: await creator(9100),
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      maxParticipants: 10,
      targetChatId: -1001234567891n,
    });
    await expect(engine.fundCampaign(created.id, 100_000n)).rejects.toThrow(/insufficient/);
    await engine.fundCampaign(created.id, 1_500_000n);
    expect((await engine.getCampaignStats(created.id)).balanceMicroUsdc).toBe(1_500_000n);
    expect((await engine.activateCampaign(created.id)).status).toBe("ACTIVE");
    expect((await engine.pauseCampaign(created.id)).status).toBe("PAUSED");
    expect((await engine.resumeCampaign(created.id)).status).toBe("ACTIVE");
    expect((await engine.closeCampaign(created.id)).status).toBe("CLOSED");
    await expect(engine.pauseCampaign(created.id)).rejects.toThrow(/invalid campaign transition/);
  });
});
```

- [ ] **Step 2: Run test**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/campaign && pnpm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/campaign/test/engine.test.ts
git commit -m "test(campaign): lifecycle and funding threshold coverage"
```

---

## Task 9: @spark/referral package + engine (codes + link)

**Files:**
- Create: `packages/referral/package.json`, `packages/referral/tsconfig.json`
- Create: `packages/referral/src/state.ts`, `packages/referral/src/engine.ts`, `packages/referral/src/index.ts`
- Test: `packages/referral/test/engine.test.ts`

- [ ] **Step 1: Scaffold.** Create `packages/referral/package.json`:

```json
{
  "name": "@spark/referral",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@spark/db": "workspace:*",
    "@spark/domain": "workspace:*",
    "@spark/telegram": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  }
}
```

Create `packages/referral/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

Run: `export PATH="$HOME/.local/bin:$PATH" && pnpm install`

- [ ] **Step 2: Write the failing test.** Create `packages/referral/test/engine.test.ts`:

```ts
import { type Db, createCampaign, findReferral, upsertReferralAttribution, upsertUserByTelegramId } from "@spark/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../db/test/harness";
import { createReferralEngine } from "../src";
import { canTransitionReferral } from "../src/state";

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

describe("referral state machine", () => {
  it("allows the canonical lifecycle only", () => {
    expect(canTransitionReferral("ATTRIBUTED", "QUALIFIED")).toBe(true);
    expect(canTransitionReferral("QUALIFIED", "REWARD_PENDING")).toBe(true);
    expect(canTransitionReferral("REWARD_PENDING", "PAID")).toBe(true);
    expect(canTransitionReferral("ATTRIBUTED", "PAID")).toBe(false);
    expect(canTransitionReferral("PAID", "REWARD_PENDING")).toBe(false);
  });
});

describe("ReferralEngine link", () => {
  it("issues a stable code and builds a c_<publicId>_<code> deep link", async () => {
    const engine = createReferralEngine({ db });
    const referrer = await upsertUserByTelegramId(db, { telegramUserId: 9200n });
    const campaign = await createCampaign(db, {
      publicId: "reflink0000000001",
      creatorId: referrer.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
    });
    const link = await engine.linkForReferrer({
      campaignId: campaign.id,
      publicId: campaign.publicId,
      referrerUserId: referrer.id,
      botUsername: "spark_bot",
      appName: "spark",
    });
    expect(link.startapp).toBe(`c_${campaign.publicId}_${link.referralCode}`);
    expect(link.deepLink).toBe(
      `https://t.me/spark_bot/spark?startapp=${encodeURIComponent(link.startapp)}`,
    );
  });
});

describe("ReferralEngine attribution", () => {
  it("attributes a valid code, is idempotent, and qualifies after verification", async () => {
    const engine = createReferralEngine({ db });
    const referrer = await upsertUserByTelegramId(db, { telegramUserId: 9201n });
    const referred = await upsertUserByTelegramId(db, { telegramUserId: 9202n });
    const campaign = await createCampaign(db, {
      publicId: "refattr0000000001",
      creatorId: referrer.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
    });
    const link = await engine.linkForReferrer({
      campaignId: campaign.id,
      publicId: campaign.publicId,
      referrerUserId: referrer.id,
      botUsername: "spark_bot",
      appName: "spark",
    });

    const attributed = await engine.attribute({
      campaignPublicId: campaign.publicId,
      referralCode: link.referralCode,
      referredUserId: referred.id,
    });
    expect(attributed?.status).toBe("ATTRIBUTED");
    expect(attributed?.referrerUserId).toBe(referrer.id);

    const again = await engine.attribute({
      campaignPublicId: campaign.publicId,
      referralCode: link.referralCode,
      referredUserId: referred.id,
    });
    expect(again?.id).toBe(attributed?.id);

    const qualified = await engine.qualify(campaign.id, referred.id);
    expect(qualified?.status).toBe("QUALIFIED");
    expect((await findReferral(db, campaign.id, referred.id))?.qualifiedAt).not.toBeNull();
  });

  it("ignores an unknown code", async () => {
    const engine = createReferralEngine({ db });
    const referrer = await upsertUserByTelegramId(db, { telegramUserId: 9203n });
    const referred = await upsertUserByTelegramId(db, { telegramUserId: 9204n });
    const campaign = await createCampaign(db, {
      publicId: "refattr0000000002",
      creatorId: referrer.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 50_000n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
    });
    expect(
      await engine.attribute({
        campaignPublicId: campaign.publicId,
        referralCode: "nope1234",
        referredUserId: referred.id,
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/referral && pnpm test`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `state.ts`:**

```ts
export const REFERRAL_STATES = [
  "ATTRIBUTED",
  "QUALIFIED",
  "REWARD_PENDING",
  "PAID",
  "REJECTED",
] as const;

export type ReferralState = (typeof REFERRAL_STATES)[number];

export const REFERRAL_TRANSITIONS: Record<ReferralState, readonly ReferralState[]> = {
  ATTRIBUTED: ["QUALIFIED", "REJECTED"],
  QUALIFIED: ["REWARD_PENDING", "REJECTED"],
  REWARD_PENDING: ["PAID", "REJECTED"],
  PAID: [],
  REJECTED: [],
};

export function canTransitionReferral(from: ReferralState, to: ReferralState): boolean {
  return REFERRAL_TRANSITIONS[from].includes(to);
}

export function assertReferralTransition(from: ReferralState, to: ReferralState): void {
  if (!canTransitionReferral(from, to)) {
    throw new ReferralError(`invalid referral transition: ${from} -> ${to}`);
  }
}

export class ReferralError extends Error {
  override readonly name = "ReferralError";
}
```

- [ ] **Step 5: Implement `engine.ts`:**

```ts
import {
  type Db,
  findCampaignByPublicId,
  findParticipation,
  findReferral,
  findReferrerByCode,
  getOrCreateReferralCode,
  type ReferralRow,
  updateReferralStatus,
  upsertReferralAttribution,
} from "@spark/db";
import { generateReferralCode } from "@spark/domain";
import { buildCampaignDeepLink } from "@spark/telegram";
import { assertReferralTransition, type ReferralState } from "./state";

export interface ReferralLink {
  startapp: string;
  deepLink: string;
  referralCode: string;
}

export interface ReferralEngine {
  linkForReferrer(input: {
    campaignId: string;
    publicId: string;
    referrerUserId: string;
    botUsername: string;
    appName: string;
  }): Promise<ReferralLink>;
  attribute(input: {
    campaignPublicId: string;
    referralCode: string;
    referredUserId: string;
  }): Promise<ReferralRow | null>;
  qualify(campaignId: string, referredUserId: string): Promise<ReferralRow | null>;
}

export function createReferralEngine(deps: { db: Db }): ReferralEngine {
  const { db } = deps;

  async function move(referral: ReferralRow, to: ReferralState): Promise<ReferralRow> {
    assertReferralTransition(referral.status as ReferralState, to);
    const extra: { qualifiedAt?: Date } = {};
    if (to === "QUALIFIED") extra.qualifiedAt = new Date();
    return updateReferralStatus(db, referral.id, to, extra);
  }

  return {
    async linkForReferrer(input) {
      const code = await getOrCreateReferralCode(db, {
        campaignId: input.campaignId,
        referrerUserId: input.referrerUserId,
        generate: generateReferralCode,
      });
      const startapp = `c_${input.publicId}_${code}`;
      const deepLink = buildCampaignDeepLink(input.botUsername, input.appName, startapp);
      return { startapp, deepLink, referralCode: code };
    },

    async attribute(input) {
      const campaign = await findCampaignByPublicId(db, input.campaignPublicId);
      if (!campaign) return null;

      const referrer = await findReferrerByCode(db, campaign.id, input.referralCode);
      if (referrer === null || referrer.id === input.referredUserId) return null;

      const existing = await findReferral(db, campaign.id, input.referredUserId);
      if (existing) return existing;

      const participation = await findParticipation(db, campaign.id, input.referredUserId);
      if (participation) return null;

      return upsertReferralAttribution(db, {
        campaignId: campaign.id,
        referrerUserId: referrer.id,
        referredUserId: input.referredUserId,
        referralCode: input.referralCode,
      });
    },

    async qualify(campaignId, referredUserId) {
      const referral = await findReferral(db, campaignId, referredUserId);
      if (!referral) return null;
      if (referral.status === "ATTRIBUTED") return move(referral, "QUALIFIED");
      return referral;
    },
  };
}
```

- [ ] **Step 6: Implement `index.ts`:**

```ts
export * from "./engine";
export * from "./state";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/referral && pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/referral pnpm-lock.yaml
git commit -m "feat(referral): referral engine codes, links, attribution"
```

---

## Task 10: @spark/reward package + settlement port + mock

**Files:**
- Create: `packages/reward/package.json`, `packages/reward/tsconfig.json`
- Create: `packages/reward/src/settlement.ts`, `packages/reward/src/index.ts`
- Test: `packages/reward/test/settlement.test.ts`

- [ ] **Step 1: Scaffold.** Create `packages/reward/package.json`:

```json
{
  "name": "@spark/reward",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@spark/db": "workspace:*",
    "@spark/ledger": "workspace:*",
    "@spark/rewards": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  }
}
```

Create `packages/reward/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

Run: `export PATH="$HOME/.local/bin:$PATH" && pnpm install`

- [ ] **Step 2: Write the failing test.** Create `packages/reward/test/settlement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockSettlement } from "../src";

describe("MockSettlement", () => {
  it("returns a stable hash and confirms payouts", async () => {
    const settlement = createMockSettlement();
    const first = await settlement.submitPayout({
      campaignId: "c1",
      rewardId: "r1",
      nonce: 1n,
      recipientWallet: "0xabc",
      amountMicroUsdc: 100_000n,
    });
    expect(first.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await settlement.getPayoutStatus(first.txHash)).toBe("confirmed");
    const second = await settlement.submitPayout({
      campaignId: "c1",
      rewardId: "r1",
      nonce: 1n,
      recipientWallet: "0xabc",
      amountMicroUsdc: 100_000n,
    });
    expect(second.txHash).toBe(first.txHash);
  });

  it("reports failed for an unknown hash", async () => {
    const settlement = createMockSettlement();
    expect(await settlement.getPayoutStatus(`0x${"0".repeat(64)}`)).toBe("failed");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/reward && pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `settlement.ts`:**

```ts
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
```

- [ ] **Step 5: Implement `index.ts` (initial):**

```ts
export * from "./settlement";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/reward && pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/reward pnpm-lock.yaml
git commit -m "feat(reward): settlement port and mock settlement"
```

---

## Task 11: @spark/reward — RewardEngine authorization + transitions

**Files:**
- Create: `packages/reward/src/engine.ts`, `packages/reward/src/errors.ts`
- Modify: `packages/reward/src/index.ts`
- Test: `packages/reward/test/engine.test.ts`

- [ ] **Step 1: Write the failing test.** Create `packages/reward/test/engine.test.ts`:

```ts
import {
  type Db,
  createCampaign,
  createMembershipTask,
  createParticipation,
  findCampaignById,
  findParticipationById,
  findRewardByType,
  findReferral,
  updateParticipationStatus,
  updateReferralStatus,
  upsertReferralAttribution,
  upsertUserByTelegramId,
} from "@spark/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../db/test/harness";
import { createRewardEngine } from "../src";

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

let counter = 0;
async function setupActiveCampaign() {
  counter += 1;
  const referrer = await upsertUserByTelegramId(db, { telegramUserId: BigInt(9300 + counter * 10) });
  const referred = await upsertUserByTelegramId(db, { telegramUserId: BigInt(9301 + counter * 10) });
  const campaign = await createCampaign(db, {
    publicId: `reward${String(counter).padStart(11, "0")}`,
    creatorId: referrer.id,
    chainId: 5042002,
    rewardMicroUsdc: 100_000n,
    referralRewardMicroUsdc: 50_000n,
    budgetMicroUsdc: 1_000_000n,
    balanceMicroUsdc: 1_000_000n,
    status: "ACTIVE",
  });
  const task = await createMembershipTask(db, {
    campaignId: campaign.id,
    rewardMicroUsdc: 100_000n,
    chatId: "-1004",
  });
  const participation = await createParticipation(db, {
    campaignId: campaign.id,
    userId: referred.id,
    taskId: task.id,
  });
  await updateParticipationStatus(db, participation.id, "VERIFIED", { verifiedAt: new Date() });
  await upsertReferralAttribution(db, {
    campaignId: campaign.id,
    referrerUserId: referrer.id,
    referredUserId: referred.id,
    referralCode: "reward01",
  });
  const referral = (await findReferral(db, campaign.id, referred.id))!;
  await updateReferralStatus(db, referral.id, "QUALIFIED", { qualifiedAt: new Date() });
  return { campaign, participation, referred, referrer };
}

describe("RewardEngine.authorizeForParticipation", () => {
  it("authorizes user + referral rewards and reserves budget", async () => {
    const engine = createRewardEngine({ db });
    const { campaign, participation, referred, referrer } = await setupActiveCampaign();
    const rewards = await engine.authorizeForParticipation(campaign.id, participation.id);
    expect(rewards.map((r) => r.rewardType).sort()).toEqual(["REFERRAL", "USER_COMPLETION"]);

    const userReward = await findRewardByType(db, campaign.id, participation.id, "USER_COMPLETION");
    expect(userReward?.status).toBe("AUTHORIZED");
    expect(userReward?.amountMicroUsdc).toBe(100_000n);
    expect(userReward?.recipientUserId).toBe(referred.id);

    const referralReward = await findRewardByType(db, campaign.id, participation.id, "REFERRAL");
    expect(referralReward?.amountMicroUsdc).toBe(50_000n);
    expect(referralReward?.recipientUserId).toBe(referrer.id);
    expect((await findReferral(db, campaign.id, referred.id))?.status).toBe("REWARD_PENDING");

    expect((await findCampaignById(db, campaign.id))?.balanceMicroUsdc).toBe(850_000n);
    expect((await findParticipationById(db, participation.id))?.status).toBe("REWARD_PENDING");
  });

  it("marks the referral row PAID when the REFERRAL reward settles", async () => {
    const engine = createRewardEngine({ db });
    const { campaign, participation, referred } = await setupActiveCampaign();
    const rewards = await engine.authorizeForParticipation(campaign.id, participation.id);
    const referralReward = rewards.find((r) => r.rewardType === "REFERRAL")!;
    await engine.markSubmitted(referralReward.id, "0x".padEnd(66, "a"));
    await engine.markConfirmed(referralReward.id);
    await engine.markPaid(referralReward.id);
    expect((await findRewardByType(db, campaign.id, participation.id, "REFERRAL"))?.status).toBe(
      "PAID",
    );
    expect((await findReferral(db, campaign.id, referred.id))?.status).toBe("PAID");
  });

  it("is idempotent on repeat authorization", async () => {
    const engine = createRewardEngine({ db });
    const { campaign, participation } = await setupActiveCampaign();
    await engine.authorizeForParticipation(campaign.id, participation.id);
    const second = await engine.authorizeForParticipation(campaign.id, participation.id);
    expect(second.length).toBe(2);
    expect(
      (await findCampaignById(db, campaign.id))?.balanceMicroUsdc,
    ).toBe(850_000n);
  });

  it("throws when the campaign cannot cover the reward", async () => {
    const engine = createRewardEngine({ db });
    const { campaign, participation } = await setupActiveCampaign();
    const { reserveCampaignBudget } = await import("@spark/db");
    expect(await reserveCampaignBudget(db, campaign.id, 1_000_000n)).toBe(true);
    await expect(
      engine.authorizeForParticipation(campaign.id, participation.id),
    ).rejects.toThrow(/budget/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/reward && pnpm test`
Expected: FAIL — `createRewardEngine` not found.

- [ ] **Step 3: Implement `errors.ts`:**

```ts
export class RewardEngineError extends Error {
  override readonly name = "RewardEngineError";
}
```

- [ ] **Step 4: Implement `engine.ts`:**

```ts
import {
  appendLedgerEntry,
  createReward,
  type Db,
  findCampaignById,
  findParticipationById,
  findReferral,
  findRewardById,
  findRewardByType,
  listSettleableRewards,
  nextRewardNonce,
  type RewardRow,
  reserveCampaignBudget,
  updateParticipationStatus,
  updateReferralStatus,
  updateRewardStatus,
} from "@spark/db";
import { canTransitionReward, type RewardState } from "@spark/rewards";
import { RewardEngineError } from "./errors";

export interface RewardEngine {
  authorizeForParticipation(campaignId: string, participationId: string): Promise<RewardRow[]>;
  listSettleable(limit: number): Promise<RewardRow[]>;
  markSubmitted(rewardId: string, txHash: string): Promise<void>;
  markConfirmed(rewardId: string): Promise<void>;
  markPaid(rewardId: string): Promise<void>;
  markSubmissionFailed(rewardId: string): Promise<void>;
}

export function createRewardEngine(deps: { db: Db; now?: () => number }): RewardEngine {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());

  async function loadReward(rewardId: string): Promise<RewardRow> {
    const reward = await findRewardById(db, rewardId);
    if (!reward) throw new RewardEngineError("reward not found");
    return reward;
  }

  async function move(
    reward: RewardRow,
    to: RewardState,
    extra: Parameters<typeof updateRewardStatus>[3] = {},
  ): Promise<RewardRow> {
    if (!canTransitionReward(reward.status as RewardState, to)) {
      throw new RewardEngineError(`invalid reward transition ${reward.status} -> ${to}`);
    }
    return updateRewardStatus(db, reward.id, to, extra);
  }

  async function authorizeOne(input: {
    campaignId: string;
    participationId: string;
    rewardType: RewardRow["rewardType"];
    recipientUserId: string;
    recipientWallet: string;
    amountMicroUsdc: bigint;
    chainId: number;
  }): Promise<RewardRow | null> {
    const existing = await findRewardByType(
      db,
      input.campaignId,
      input.participationId,
      input.rewardType,
    );
    if (existing) return existing;

    const reserved = await reserveCampaignBudget(db, input.campaignId, input.amountMicroUsdc);
    if (!reserved) throw new RewardEngineError("campaign budget exhausted");

    return createReward(db, {
      campaignId: input.campaignId,
      participationId: input.participationId,
      rewardType: input.rewardType,
      recipientUserId: input.recipientUserId,
      recipientWallet: input.recipientWallet,
      amountMicroUsdc: input.amountMicroUsdc,
      authorizationNonce: await nextRewardNonce(db),
      authorizationExpiresAt: new Date(now() + 7 * 24 * 3_600_000),
      status: "AUTHORIZED",
      chainId: input.chainId,
    });
  }

  return {
    async authorizeForParticipation(campaignId, participationId) {
      const campaign = await findCampaignById(db, campaignId);
      if (!campaign) throw new RewardEngineError("campaign not found");
      if (campaign.status !== "ACTIVE") throw new RewardEngineError("campaign is not active");

      const participation = await findParticipationById(db, participationId);
      if (!participation) throw new RewardEngineError("participation not found");
      if (participation.status !== "VERIFIED") {
        throw new RewardEngineError("participation is not verified");
      }

      const created: RewardRow[] = [];
      const userReward = await authorizeOne({
        campaignId,
        participationId,
        rewardType: "USER_COMPLETION",
        recipientUserId: participation.userId,
        recipientWallet: "0x0000000000000000000000000000000000000000",
        amountMicroUsdc: campaign.rewardMicroUsdc,
        chainId: campaign.chainId,
      });
      if (userReward) created.push(userReward);

      const referral = await findReferral(db, campaignId, participation.userId);
      if (referral && referral.status === "QUALIFIED") {
        const referralReward = await authorizeOne({
          campaignId,
          participationId,
          rewardType: "REFERRAL",
          recipientUserId: referral.referrerUserId,
          recipientWallet: "0x0000000000000000000000000000000000000000",
          amountMicroUsdc: campaign.referralRewardMicroUsdc,
          chainId: campaign.chainId,
        });
        if (referralReward) created.push(referralReward);
        await updateReferralStatus(db, referral.id, "REWARD_PENDING");
      }

      await updateParticipationStatus(db, participationId, "REWARD_PENDING");
      return created;
    },

    listSettleable: (limit) => listSettleableRewards(db, limit),

    async markSubmitted(rewardId, txHash) {
      await move(await loadReward(rewardId), "SUBMITTED", {
        transactionHash: txHash,
        submittedAt: new Date(),
      });
    },

    async markConfirmed(rewardId) {
      await move(await loadReward(rewardId), "CONFIRMED", { confirmedAt: new Date() });
    },

    async markPaid(rewardId) {
      const reward = await loadReward(rewardId);
      await appendLedgerEntry(db, {
        campaignId: reward.campaignId,
        rewardId: reward.id,
        entryType: reward.rewardType === "REFERRAL" ? "REFERRAL_REWARD" : "USER_REWARD",
        amountMicroUsdc: reward.amountMicroUsdc,
        direction: -1,
        idempotencyKey: `reward:${reward.id}`,
      });
      await move(reward, "PAID", { confirmedAt: reward.confirmedAt ?? new Date() });
      if (reward.rewardType === "REFERRAL" && reward.participationId) {
        const participation = await findParticipationById(db, reward.participationId);
        if (participation) {
          const referral = await findReferral(db, reward.campaignId, participation.userId);
          if (referral && referral.status === "REWARD_PENDING") {
            await updateReferralStatus(db, referral.id, "PAID");
          }
        }
      }
    },

    async markSubmissionFailed(rewardId) {
      await move(await loadReward(rewardId), "SUBMISSION_FAILED");
    },
  };
}
```

- [ ] **Step 5: Update `index.ts`:**

```ts
export * from "./engine";
export * from "./errors";
export * from "./settlement";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd packages/reward && pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/reward
git commit -m "feat(reward): reward engine authorization and state transitions"
```

---

## Task 12: Worker settlement via MockSettlement

**Files:**
- Modify: `worker/package.json`
- Modify: `worker/src/settlement/index.ts`
- Create: `worker/test/settlement.test.ts`

- [ ] **Step 1: Add the dependency.** In `worker/package.json`, add `"@spark/reward": "workspace:*"` to `dependencies`. Run `export PATH="$HOME/.local/bin:$PATH" && pnpm install`.

- [ ] **Step 2: Write the failing test.** Create `worker/test/settlement.test.ts`:

```ts
import {
  type Db,
  createCampaign,
  createMembershipTask,
  createParticipation,
  findParticipationById,
  findRewardByType,
  updateParticipationStatus,
  upsertUserByTelegramId,
} from "@spark/db";
import { createRewardEngine } from "@spark/reward";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../packages/db/test/harness";
import { settleAuthorizedRewards } from "../src/settlement";

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.db;
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

describe("settlement loop", () => {
  it("drives AUTHORIZED rewards through CONFIRMED to PAID", async () => {
    const engine = createRewardEngine({ db });
    const u = await upsertUserByTelegramId(db, { telegramUserId: 9400n });
    const campaign = await createCampaign(db, {
      publicId: "settle0000000001",
      creatorId: u.id,
      chainId: 5042002,
      rewardMicroUsdc: 100_000n,
      referralRewardMicroUsdc: 0n,
      budgetMicroUsdc: 1_000_000n,
      balanceMicroUsdc: 1_000_000n,
      status: "ACTIVE",
    });
    const task = await createMembershipTask(db, {
      campaignId: campaign.id,
      rewardMicroUsdc: 100_000n,
      chatId: "-1005",
    });
    const p = await createParticipation(db, {
      campaignId: campaign.id,
      userId: u.id,
      taskId: task.id,
    });
    await updateParticipationStatus(db, p.id, "VERIFIED", { verifiedAt: new Date() });
    await engine.authorizeForParticipation(campaign.id, p.id);

    expect(await settleAuthorizedRewards({ db, limit: 10 })).toBe(1);

    const reward = await findRewardByType(db, campaign.id, p.id, "USER_COMPLETION");
    expect(reward?.status).toBe("PAID");
    expect(reward?.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect((await findParticipationById(db, p.id))?.status).toBe("REWARD_PENDING");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd worker && pnpm test`
Expected: FAIL — `settleAuthorizedRewards` not exported.

- [ ] **Step 4: Implement `worker/src/settlement/index.ts`:**

```ts
import type { Db } from "@spark/db";
import { createMockSettlement, createRewardEngine, type SettlementPort } from "@spark/reward";

export interface SettlementDeps {
  db: Db;
  settlement?: SettlementPort;
  limit?: number;
}

export async function settleAuthorizedRewards(deps: SettlementDeps): Promise<number> {
  const settlement = deps.settlement ?? createMockSettlement();
  const engine = createRewardEngine({ db: deps.db });
  const rewards = await engine.listSettleable(deps.limit ?? 25);
  let processed = 0;

  for (const reward of rewards) {
    try {
      const { txHash } = await settlement.submitPayout({
        campaignId: reward.campaignId,
        rewardId: reward.id,
        nonce: reward.authorizationNonce,
        recipientWallet: reward.recipientWallet,
        amountMicroUsdc: reward.amountMicroUsdc,
      });
      await engine.markSubmitted(reward.id, txHash);

      const status = await settlement.getPayoutStatus(txHash);
      if (status === "confirmed") {
        await engine.markConfirmed(reward.id);
        await engine.markPaid(reward.id);
        processed += 1;
      } else if (status === "failed") {
        await engine.markSubmissionFailed(reward.id);
      }
    } catch {
      await engine.markSubmissionFailed(reward.id);
    }
  }

  return processed;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd worker && pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker pnpm-lock.yaml
git commit -m "feat(worker): mock settlement loop"
```

---

## Task 13: API campaign routes

**Files:**
- Create: `apps/api/src/routes/campaigns.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/test/server.test.ts`
- Test: `apps/api/test/campaigns.test.ts`

- [ ] **Step 1: Extend `ApiDeps` and register routes.** In `apps/api/src/server.ts`:

```ts
import type { CampaignEngine } from "@spark/campaign";
import type { ReferralEngine } from "@spark/referral";
import type { RewardEngine } from "@spark/reward";
import { registerCampaignRoutes } from "./routes/campaigns";

export interface ApiDeps {
  db: Db;
  telegram: TelegramBotApi | undefined;
  membershipCache: MembershipCache;
  sessionTtlSeconds: number;
  nodeEnv: "development" | "test" | "production";
  campaignEngine: CampaignEngine;
  referralEngine: ReferralEngine;
  rewardEngine: RewardEngine;
}
```

Inside the scoped `app.register(async (instance) => { ... })`, add `registerCampaignRoutes(instance, deps);`.

- [ ] **Step 2: Write the failing test.** Create `apps/api/test/campaigns.test.ts` (mirror the harness/login setup from `apps/api/test/verify.test.ts`, extending `deps` with the three engines):

```ts
import { createCampaignEngine } from "@spark/campaign";
import { createReferralEngine } from "@spark/referral";
import { createRewardEngine } from "@spark/reward";
import { signInitData, TelegramBotClient } from "@spark/telegram";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "../../../packages/db/test/harness";
import { createMembershipCache } from "../src/cache/membershipCache";
import { type ApiDeps, buildServer } from "../src/server";

const BOT_TOKEN = "123456:TEST_BOT_TOKEN";
let h: Harness;
let deps: ApiDeps;

beforeAll(async () => {
  h = await startHarness();
  deps = {
    db: h.db,
    telegram: new TelegramBotClient({ botToken: BOT_TOKEN }),
    membershipCache: createMembershipCache(300_000),
    sessionTtlSeconds: 3600,
    nodeEnv: "test",
    campaignEngine: createCampaignEngine({ db: h.db }),
    referralEngine: createReferralEngine({ db: h.db }),
    rewardEngine: createRewardEngine({ db: h.db }),
  };
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

async function login(app: ReturnType<typeof buildServer>): Promise<string> {
  const initData = signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "AAF",
      user: JSON.stringify({ id: 5150, first_name: "Cara", username: "cara" }),
    },
    BOT_TOKEN,
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/telegram",
    payload: { initData },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

describe("campaign routes", () => {
  it("creates, funds, activates, and reports stats", async () => {
    const app = buildServer(deps);
    const token = await login(app);
    const auth = { authorization: `Bearer ${token}` };

    const create = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      headers: auth,
      payload: {
        rewardMicroUsdc: "100000",
        referralRewardMicroUsdc: "50000",
        budgetMicroUsdc: "1000000",
        maxParticipants: 10,
        targetChatId: "-1001234567890",
      },
    });
    expect(create.statusCode).toBe(201);
    const { publicId } = create.json() as { publicId: string };

    const fund = await app.inject({
      method: "POST",
      url: `/api/campaigns/${publicId}/fund`,
      headers: auth,
      payload: { amountMicroUsdc: "1500000" },
    });
    expect(fund.statusCode).toBe(200);
    expect((fund.json() as { status: string }).status).toBe("FUNDED");

    const activate = await app.inject({
      method: "POST",
      url: `/api/campaigns/${publicId}/activate`,
      headers: auth,
    });
    expect((activate.json() as { status: string }).status).toBe("ACTIVE");

    const stats = await app.inject({
      method: "GET",
      url: `/api/campaigns/${publicId}/stats`,
      headers: auth,
    });
    expect(stats.json()).toMatchObject({ balanceMicroUsdc: "1500000" });
    await app.close();
  });

  it("returns 401 without a session", async () => {
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: { rewardMicroUsdc: "1", referralRewardMicroUsdc: "0", budgetMicroUsdc: "1" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd apps/api && pnpm test -- campaigns`
Expected: FAIL — route not found / `campaignEngine` missing.

- [ ] **Step 4: Implement `apps/api/src/routes/campaigns.ts`:**

```ts
import type { CampaignRow } from "@spark/db";
import { findCampaignByPublicId } from "@spark/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { extractToken, resolveSession } from "../auth/resolveSession";
import type { ApiDeps } from "../server";

const createSchema = z.object({
  rewardMicroUsdc: z.string().regex(/^\d+$/),
  referralRewardMicroUsdc: z.string().regex(/^\d+$/),
  budgetMicroUsdc: z.string().regex(/^\d+$/),
  maxParticipants: z.number().int().positive().optional(),
  targetChatId: z.string().optional(),
  targetChatUsername: z.string().optional(),
});

const fundSchema = z.object({ amountMicroUsdc: z.string().regex(/^\d+$/) });

function serialize(campaign: CampaignRow) {
  return {
    publicId: campaign.publicId,
    status: campaign.status,
    rewardMicroUsdc: campaign.rewardMicroUsdc.toString(),
    referralRewardMicroUsdc: campaign.referralRewardMicroUsdc.toString(),
    budgetMicroUsdc: campaign.budgetMicroUsdc.toString(),
    balanceMicroUsdc: campaign.balanceMicroUsdc.toString(),
    maxParticipants: campaign.maxParticipants,
    participantCount: campaign.participantCount,
    targetChatId: campaign.targetChatId?.toString() ?? null,
  };
}

export function registerCampaignRoutes(app: FastifyInstance, deps: ApiDeps): void {
  async function requireUser(request: FastifyRequest): Promise<{ id: string } | null> {
    const token = extractToken(request.headers);
    if (!token) return null;
    return resolveSession(deps.db, token);
  }

  app.post("/api/campaigns", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const created = await deps.campaignEngine.createCampaign({
      creatorId: user.id,
      chainId: 5042002,
      rewardMicroUsdc: BigInt(parsed.data.rewardMicroUsdc),
      referralRewardMicroUsdc: BigInt(parsed.data.referralRewardMicroUsdc),
      budgetMicroUsdc: BigInt(parsed.data.budgetMicroUsdc),
      ...(parsed.data.maxParticipants === undefined
        ? {}
        : { maxParticipants: parsed.data.maxParticipants }),
      ...(parsed.data.targetChatId === undefined
        ? {}
        : { targetChatId: BigInt(parsed.data.targetChatId) }),
      ...(parsed.data.targetChatUsername === undefined
        ? {}
        : { targetChatUsername: parsed.data.targetChatUsername }),
    });
    return reply.code(201).send(serialize(created));
  });

  app.post<{ Params: { publicId: string } }>(
    "/api/campaigns/:publicId/fund",
    async (request, reply) => {
      const user = await requireUser(request);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });
      const parsed = fundSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
      const campaign = await findCampaignByPublicId(deps.db, request.params.publicId);
      if (!campaign) return reply.code(404).send({ error: "not_found" });
      const funded = await deps.campaignEngine.fundCampaign(
        campaign.id,
        BigInt(parsed.data.amountMicroUsdc),
      );
      return reply.send(serialize(funded));
    },
  );

  const actions = {
    activate: "activateCampaign",
    pause: "pauseCampaign",
    resume: "resumeCampaign",
    close: "closeCampaign",
  } as const;

  for (const [path, method] of Object.entries(actions)) {
    app.post<{ Params: { publicId: string } }>(
      `/api/campaigns/:publicId/${path}`,
      async (request, reply) => {
        const user = await requireUser(request);
        if (!user) return reply.code(401).send({ error: "unauthenticated" });
        const campaign = await findCampaignByPublicId(deps.db, request.params.publicId);
        if (!campaign) return reply.code(404).send({ error: "not_found" });
        try {
          const result = await deps.campaignEngine[method](campaign.id);
          return reply.send(serialize(result));
        } catch {
          return reply.code(409).send({ error: "invalid_transition" });
        }
      },
    );
  }

  app.get<{ Params: { publicId: string } }>(
    "/api/campaigns/:publicId/stats",
    async (request, reply) => {
      const user = await requireUser(request);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });
      const campaign = await findCampaignByPublicId(deps.db, request.params.publicId);
      if (!campaign) return reply.code(404).send({ error: "not_found" });
      const stats = await deps.campaignEngine.getCampaignStats(campaign.id);
      return reply.send({
        participantCount: stats.participantCount,
        maxParticipants: stats.maxParticipants,
        balanceMicroUsdc: stats.balanceMicroUsdc.toString(),
        budgetMicroUsdc: stats.budgetMicroUsdc.toString(),
      });
    },
  );
}
```

- [ ] **Step 5: Wire deps in `apps/api/src/index.ts`:**

```ts
import { createCampaignEngine } from "@spark/campaign";
import { createReferralEngine } from "@spark/referral";
import { createRewardEngine } from "@spark/reward";
```

Build the `db` once (`const db = buildDb(env.DATABASE_URL);`) and pass all three engines into `buildServer`.

- [ ] **Step 6: Update `apps/api/test/server.test.ts`** `testDeps()` to include:

```ts
    campaignEngine: createCampaignEngine({ db: {} as Db }),
    referralEngine: createReferralEngine({ db: {} as Db }),
    rewardEngine: createRewardEngine({ db: {} as Db }),
```

with matching imports.

- [ ] **Step 7: Run tests to verify they pass**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd apps/api && pnpm test -- campaigns && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): campaign lifecycle routes"
```

---

## Task 14: API auth referralCode + verify participation/rewards + referral link

**Files:**
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/routes/verify.ts`
- Test: `apps/api/test/auth.test.ts`, `apps/api/test/verify.test.ts`

- [ ] **Step 1: Write the failing tests.** In `apps/api/test/auth.test.ts` add a case that posts `{ initData, campaignPublicId, referralCode }` and asserts a `referrals` row exists for the referred telegram id. In `apps/api/test/verify.test.ts`, add a case asserting the success response includes `rewardsAuthorized >= 1` and that a `participations` row was created. Seed an ACTIVE campaign with a membership task and a valid referral code (create it via `getOrCreateReferralCode`) for the logged-in user.

- [ ] **Step 2: Run tests**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd apps/api && pnpm test -- verify`
Expected: FAIL.

- [ ] **Step 3: Implement auth attribution.** In `apps/api/src/routes/auth.ts`, change the body schema and attribute after successful auth:

```ts
const bodySchema = z.object({
  initData: z.string().min(1),
  referralCode: z.string().regex(/^[0-9a-z]{8}$/).optional(),
  campaignPublicId: z.string().regex(/^[0-9a-z]{16,32}$/).optional(),
});
```

After `authenticateTelegram` succeeds and before sending the response:

```ts
    if (parsed.data.referralCode && parsed.data.campaignPublicId) {
      try {
        await deps.referralEngine.attribute({
          campaignPublicId: parsed.data.campaignPublicId,
          referralCode: parsed.data.referralCode,
          referredUserId: outcome.result.user.id,
        });
      } catch {
        // attribution never blocks authentication
      }
    }
```

- [ ] **Step 4: Implement verify recording + reward authorization.** In `apps/api/src/routes/verify.ts`, add imports:

```ts
import {
  createParticipation,
  findCampaignByPublicId,
  findMembershipTask,
  findParticipation,
  updateParticipationStatus,
} from "@spark/db";
```

Replace the `if (result.ok) { ... }` success branch with:

```ts
      if (result.ok) {
        deps.membershipCache.set(cacheKey, {
          verified: true,
          memberStatus: result.memberStatus,
          expiresAt: Date.now() + deps.membershipCache.ttlMs,
        });

        const participation =
          (await findParticipation(deps.db, campaign.id, user.id)) ??
          (await createParticipation(deps.db, {
            campaignId: campaign.id,
            userId: user.id,
            taskId: task.id,
          }));

        await deps.referralEngine.qualify(campaign.id, user.id);

        let rewardsAuthorized = 0;
        if (participation.status === "STARTED" || participation.status === "PENDING_VERIFICATION") {
          await updateParticipationStatus(deps.db, participation.id, "VERIFIED", {
            verifiedAt: new Date(),
          });
          const rewards = await deps.rewardEngine.authorizeForParticipation(
            campaign.id,
            participation.id,
          );
          rewardsAuthorized = rewards.length;
        }

        return reply.send({
          verified: true,
          memberStatus: result.memberStatus,
          campaignId: campaign.publicId,
          cached: false,
          rewardsAuthorized,
        });
      }
```

- [ ] **Step 5: Add a referral-link route.** Add to `apps/api/src/routes/campaigns.ts`, inside `registerCampaignRoutes`:

```ts
  app.get<{ Params: { publicId: string } }>(
    "/api/campaigns/:publicId/referral-link",
    async (request, reply) => {
      const user = await requireUser(request);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });
      const campaign = await findCampaignByPublicId(deps.db, request.params.publicId);
      if (!campaign) return reply.code(404).send({ error: "not_found" });
      const link = await deps.referralEngine.linkForReferrer({
        campaignId: campaign.id,
        publicId: campaign.publicId,
        referrerUserId: user.id,
        botUsername: deps.botUsername,
        appName: deps.appName,
      });
      return reply.send(link);
    },
  );
```

Add `botUsername: string; appName: string;` to `ApiDeps` and wire them from env in `apps/api/src/index.ts` (add `TELEGRAM_BOT_USERNAME` / `TELEGRAM_APP_NAME` optional env vars with defaults, or reuse bot env values). Update `testDeps()` and the campaign test deps with `botUsername: "spark_bot", appName: "spark"`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd apps/api && pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): referral attribution, verify rewards, referral-link route"
```

---

## Task 15: Bot referral share

**Files:**
- Modify: `apps/bot/src/message.ts`
- Test: `apps/bot/src/message.test.ts` (existing) or `apps/bot/test/message.test.ts`

- [ ] **Step 1: Locate the bot tests**

Run: `export PATH="$HOME/.local/bin:$PATH" && ls apps/bot && find apps/bot -name "*.test.ts"`
If tests live in `apps/bot/test/`, add there; otherwise create `apps/bot/test/message.test.ts`.

- [ ] **Step 2: Write the failing test** — verify `handleMessage` supports a `/share` command that sends a message containing the API referral link when given a campaign publicId, using a stubbed API base URL:

```ts
  it("responds to /share with a referral link built from the API", async () => {
    const sent: unknown[] = [];
    const api = {
      getMe: async () => ({ id: 1, username: "spark_bot" }),
      getUpdates: async () => [],
      sendMessage: async (_chat: string, text: string, _opts: unknown) => {
        sent.push(text);
        return {};
      },
      chatMember: async () => ({ status: "member" }),
      botToken: "t",
    } as unknown as TelegramBotApi;
    const env = {
      webappUrl: "https://app.example",
      appName: "spark",
      botUsername: "spark_bot",
      apiOrigin: "https://api.example",
      apiToken: "session-token",
    };
    await handleMessage(api, env, {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 42 },
        text: "/share pub1234567890abcd",
      },
    } as unknown as TelegramUpdate);
    expect(sent.some((t) => String(t).includes("c_pub1234567890abcd_"))).toBe(true);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd apps/bot && pnpm test`
Expected: FAIL.

- [ ] **Step 4: Implement.** In `apps/bot/src/message.ts`, extend `MessageEnv` with `apiOrigin: string; apiToken: string;`, and add a `/share` branch. The bot fetches the referral link from the API (`GET {apiOrigin}/api/campaigns/{publicId}/referral-link` with `authorization: Bearer {apiToken}`) and sends it:

```ts
  const shareMatch = /^\/share\s+([0-9a-z]{16,32})$/.exec(message.text.trim());
  if (shareMatch) {
    const publicId = shareMatch[1]!;
    try {
      const res = await fetch(
        `${env.apiOrigin.replace(/\/+$/, "")}/api/campaigns/${publicId}/referral-link`,
        { headers: { authorization: `Bearer ${env.apiToken}` } },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const link = (await res.json()) as { deepLink: string };
      await api.sendMessage(message.chat.id.toString(), "Share your referral link:", {
        replyMarkup: { inlineKeyboard: [[{ text: "Share", url: link.deepLink }]] },
      });
    } catch (err) {
      console.error("[message] share failed:", err);
    }
    return;
  }
```

Update `apps/bot/src/index.ts` and `apps/bot/src/env.ts` to supply `apiOrigin` (`API_ORIGIN`) and `apiToken` (a long-lived operator session token via `BOT_API_TOKEN`) — add both to `botEnvSchema` with `.optional()` fallbacks and only enable `/share` when present.

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd apps/bot && pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/bot
git commit -m "feat(bot): /share referral link command"
```

---

## Task 16: Mini App referralCode + status

**Files:**
- Modify: `apps/telegram-mini-app/src/api.ts`
- Modify: `apps/telegram-mini-app/src/main.ts`
- Test: `apps/telegram-mini-app/test/` (existing)

- [ ] **Step 1: Write the failing test** — in the mini-app test suite, assert `authenticate` sends `{ initData, referralCode, campaignPublicId }` and that a `fetchReferralLink` helper hits `/api/campaigns/:publicId/referral-link`:

```ts
  it("includes referral context in the auth request", async () => {
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (url: string, init: { body?: string }) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
      return { ok: true, json: async () => ({ token: "t", expiresAt: "", user: {} }) };
    }) as unknown as typeof fetch;

    const { authenticate } = await import("../src/api");
    await authenticate("https://api.example", "raw-init-data", {
      referralCode: "code1234",
      campaignPublicId: "pub1234567890abcd",
    });
    expect(calls[0]!.body).toMatchObject({
      initData: "raw-init-data",
      referralCode: "code1234",
      campaignPublicId: "pub1234567890abcd",
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd apps/telegram-mini-app && pnpm test`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `apps/telegram-mini-app/src/api.ts`, change `authenticate` to accept optional referral context (omit keys when absent, per `exactOptionalPropertyTypes`):

```ts
export async function authenticate(
  apiOrigin: string,
  initData: string,
  referral?: { referralCode?: string; campaignPublicId?: string },
): Promise<AuthResponse> {
  const body: Record<string, string> = { initData };
  if (referral?.referralCode !== undefined) body.referralCode = referral.referralCode;
  if (referral?.campaignPublicId !== undefined) body.campaignPublicId = referral.campaignPublicId;
  const res = await fetch(buildApiUrl(apiOrigin, "/api/auth/telegram"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`auth failed: ${res.status}`);
  return res.json();
}

export async function fetchReferralLink(
  apiOrigin: string,
  token: string,
  publicId: string,
): Promise<{ startapp: string; deepLink: string; referralCode: string }> {
  const res = await fetch(
    buildApiUrl(apiOrigin, `/api/campaigns/${encodeURIComponent(publicId)}/referral-link`),
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`referral link failed: ${res.status}`);
  return res.json();
}
```

In `apps/telegram-mini-app/src/main.ts`, pass the parsed `startapp` context (`{ referralCode, campaignPublicId: publicId }`) from `parseStartParam` (or the SDK `startParam`) into `authenticate`, and render campaign status + reward state. Keep existing tests green by updating their `authenticate` call sites only when they assert on the body.

- [ ] **Step 4: Run the full mini-app suite + build**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd apps/telegram-mini-app && pnpm test && pnpm build && pnpm typecheck`
Expected: PASS + successful `dist/`.

- [ ] **Step 5: Commit**

```bash
git add apps/telegram-mini-app
git commit -m "feat(mini-app): send referral context and fetch referral link"
```

---

## Task 17: End-to-end Phase 3 integration test + docs

**Files:**
- Create: `apps/api/test/phase3-e2e.test.ts`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Write the E2E test.** Create `apps/api/test/phase3-e2e.test.ts` that, against a real harness + `buildServer(deps)`, performs the full Phase 3 demo:

1. Creator logs in, `POST /api/campaigns` (DRAFT), `fund`, `activate`.
2. Creator fetches `GET /api/campaigns/:publicId/referral-link` → gets `referralCode`.
3. Referred user logs in via `POST /api/auth/telegram` with `{ initData, campaignPublicId, referralCode }` → assert a `referrals` row exists with status `ATTRIBUTED`.
4. `POST /api/campaigns/:publicId/verify` (stub `verifyChannelMembership` via a fake `TelegramBotApi` returning a member result for the referred user's chat) → assert `rewardsAuthorized >= 1`, participation `VERIFIED`/`REWARD_PENDING`, reward rows `AUTHORIZED`.
5. Run `settleAuthorizedRewards({ db })` from `@spark/reward`'s consumer `@spark/worker` — import via relative path `../../worker/src/settlement` (worker is not a dependency of api for runtime; import the function directly in the test).
6. Assert: user + referral rewards `PAID`; referral row `PAID`; `ledger_entries` contains one `USER_REWARD` and one `REFERRAL_REWARD`; campaign balance reduced accordingly.

Use direct DB assertions via `h.pool.query` for the referral/ledger checks.

- [ ] **Step 2: Run the test**

Run: `export PATH="$HOME/.local/bin:$PATH" && cd apps/api && pnpm test -- phase3-e2e`
Expected: PASS.

- [ ] **Step 3: Update `docs/ARCHITECTURE.md`** — add a "Campaign Engine (Phase 3)" section describing: the three engine packages, the referral attribution lifecycle, the reward state machine through `PAID`, atomic budget reservation, and the mock settlement boundary (Phase 4/5 will replace `MockSettlement` with the real escrow/operator wallet).

- [ ] **Step 4: Run the whole workspace suite + lint + typecheck**

Run: `export PATH="$HOME/.local/bin:$PATH" && pnpm typecheck && pnpm lint && pnpm test`
Expected: all green (forge suite still 3/3; run `cd contracts && forge test` to confirm).

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/phase3-e2e.test.ts docs/ARCHITECTURE.md
git commit -m "test(phase3): end-to-end campaign + referral + reward demo"
```

---

## Self-Review Notes (for the implementer)

- **Type consistency:** engine method names are referenced exactly as later tasks call them (`createCampaignEngine`, `createReferralEngine`, `createRewardEngine`, `settleAuthorizedRewards`, `linkForReferrer`, `authorizeForParticipation`, `listSettleable`, `markSubmitted/Confirmed/Paid/SubmissionFailed`).
- **Money:** all reward/budget amounts are `bigint`; API serializes them as decimal strings and parses with `BigInt`.
- **`exactOptionalPropertyTypes`:** optional input keys are spread conditionally (`...(x === undefined ? {} : { x })`) rather than passed as `undefined`.
- **Idempotency:** reward uniqueness `(campaignId, participationId, rewardType)`, referral uniqueness `(campaignId, referredUserId)`, referral-code uniqueness `(campaignId, code)` and `(campaignId, referrerUserId)`, ledger `idempotencyKey`.
- **Settlement is mocked:** no imports of `@spark/arc`, `@spark/wallet`, or `contracts/`. `MockSettlement` is the only `SettlementPort` implementation in Phase 3.
- **Deferred:** removing `PENDING`/`REWARDED` from the DB enum (drizzle-kit cannot drop enum values) — they remain unused in the DB; new code never writes them. Real escrow/operator settlement and the contract's `payReward(campaignId, rewardId, nonce, recipient, amount, deadline)` signature are Phase 4/5.
- **Referral reward milestones:** the referral row's `REWARD_PENDING`/`PAID` transitions live in the **RewardEngine** (Task 11: `authorizeForParticipation` → `REWARD_PENDING`, `markPaid` → `PAID`), reflecting the spec reconciliation; the ReferralEngine owns only `ATTRIBUTED`/`QUALIFIED`. Verified by Task 11's referral-settle test and Task 17's E2E.

