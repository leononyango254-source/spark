CREATE SEQUENCE IF NOT EXISTS "reward_ref_seq" START WITH 1;--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN "on_chain_reward_id" bigint;--> statement-breakpoint
UPDATE "rewards" SET "on_chain_reward_id" = nextval('reward_ref_seq') WHERE "on_chain_reward_id" IS NULL;--> statement-breakpoint
ALTER TABLE "rewards" ALTER COLUMN "on_chain_reward_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "rewards" ALTER COLUMN "recipient_wallet" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD COLUMN "failure_reason" text;--> statement-breakpoint
CREATE TABLE "chain_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"last_block_number" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_cursors_chain_contract_unique" UNIQUE("chain_id","contract_address")
);--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_on_chain_reward_id_unique" UNIQUE("on_chain_reward_id");