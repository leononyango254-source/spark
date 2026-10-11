CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'FUNDING', 'FUNDED', 'ACTIVE', 'PAUSED', 'CLOSED', 'FUNDING_FAILED');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('CAMPAIGN_FUNDING', 'USER_REWARD', 'REFERRAL_REWARD', 'CAMPAIGN_REFUND');--> statement-breakpoint
CREATE TYPE "public"."participation_status" AS ENUM('STARTED', 'PENDING_VERIFICATION', 'VERIFIED', 'WALLET_REQUIRED', 'REWARD_PENDING', 'REWARDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('PENDING', 'REWARDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."reward_status" AS ENUM('ELIGIBLE', 'AUTHORIZED', 'SUBMITTED', 'CONFIRMED', 'PAID', 'SUBMISSION_FAILED', 'RETRYING', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."reward_type" AS ENUM('USER_COMPLETION', 'REFERRAL');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('TELEGRAM_CHANNEL_MEMBERSHIP');--> statement-breakpoint
CREATE TYPE "public"."blockchain_transaction_status" AS ENUM('SUBMITTED', 'CONFIRMED', 'FAILED', 'DROPPED');--> statement-breakpoint
CREATE TYPE "public"."blockchain_transaction_type" AS ENUM('CAMPAIGN_CREATE', 'CAMPAIGN_FUND', 'REWARD_PAYOUT', 'CAMPAIGN_REFUND');--> statement-breakpoint
CREATE TABLE "campaign_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"transaction_hash" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_events_log_unique" UNIQUE("chain_id","transaction_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL,
	"creator_id" uuid NOT NULL,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"chain_id" integer NOT NULL,
	"escrow_address" text,
	"on_chain_campaign_id" bigint,
	"reward_micro_usdc" bigint NOT NULL,
	"referral_reward_micro_usdc" bigint NOT NULL,
	"budget_micro_usdc" bigint NOT NULL,
	"balance_micro_usdc" bigint NOT NULL,
	"target_chat_id" bigint,
	"target_chat_username" text,
	"deadline" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "campaigns_reward_positive" CHECK ("campaigns"."reward_micro_usdc" > 0),
	CONSTRAINT "campaigns_referral_reward_non_negative" CHECK ("campaigns"."referral_reward_micro_usdc" >= 0),
	CONSTRAINT "campaigns_budget_positive" CHECK ("campaigns"."budget_micro_usdc" > 0),
	CONSTRAINT "campaigns_balance_non_negative" CHECK ("campaigns"."balance_micro_usdc" >= 0),
	CONSTRAINT "campaigns_reward_within_budget" CHECK ("campaigns"."reward_micro_usdc" <= "campaigns"."budget_micro_usdc")
);
--> statement-breakpoint
CREATE TABLE "creator_funding_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"session_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_funding_handoffs_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"language_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"type" "task_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reward_micro_usdc" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_campaign_type_unique" UNIQUE("campaign_id","type")
);
--> statement-breakpoint
CREATE TABLE "participations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"referral_code_used" text,
	"referrer_user_id" uuid,
	"status" "participation_status" DEFAULT 'STARTED' NOT NULL,
	"reward_id" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participations_campaign_user_unique" UNIQUE("campaign_id","user_id"),
	CONSTRAINT "participations_no_self_referral" CHECK ("participations"."referrer_user_id" IS NULL OR "participations"."referrer_user_id" <> "participations"."user_id")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referred_user_id" uuid NOT NULL,
	"referral_code" text NOT NULL,
	"status" "referral_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_campaign_referred_unique" UNIQUE("campaign_id","referred_user_id"),
	CONSTRAINT "referrals_no_self_referral" CHECK ("referrals"."referrer_user_id" <> "referrals"."referred_user_id")
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"participation_id" uuid,
	"reward_type" "reward_type" NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"recipient_wallet" text NOT NULL,
	"amount_micro_usdc" bigint NOT NULL,
	"authorization_nonce" bigint NOT NULL,
	"authorization_expires_at" timestamp with time zone NOT NULL,
	"status" "reward_status" DEFAULT 'ELIGIBLE' NOT NULL,
	"chain_id" integer NOT NULL,
	"transaction_hash" text,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rewards_authorization_nonce_unique" UNIQUE("authorization_nonce"),
	CONSTRAINT "rewards_campaign_participation_type_unique" UNIQUE("campaign_id","participation_id","reward_type"),
	CONSTRAINT "rewards_amount_positive" CHECK ("rewards"."amount_micro_usdc" > 0)
);
--> statement-breakpoint
CREATE TABLE "blockchain_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reward_id" uuid,
	"campaign_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"transaction_type" "blockchain_transaction_type" NOT NULL,
	"status" "blockchain_transaction_status" DEFAULT 'SUBMITTED' NOT NULL,
	"nonce" bigint,
	"block_number" bigint,
	"error_code" text,
	"error_message" text,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blockchain_transactions_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"reward_id" uuid,
	"entry_type" "ledger_entry_type" NOT NULL,
	"amount_micro_usdc" bigint NOT NULL,
	"direction" smallint NOT NULL,
	"reference" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount_micro_usdc" > 0),
	CONSTRAINT "ledger_entries_direction_valid" CHECK ("ledger_entries"."direction" IN (1, -1))
);
--> statement-breakpoint
CREATE TABLE "wallet_associations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"normalized_address" text NOT NULL,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_associations_campaign_user_unique" UNIQUE("campaign_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_funding_handoffs" ADD CONSTRAINT "creator_funding_handoffs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_associations" ADD CONSTRAINT "wallet_associations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_associations" ADD CONSTRAINT "wallet_associations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_creator_id_idx" ON "campaigns" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "participations_campaign_id_idx" ON "participations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "rewards_campaign_id_idx" ON "rewards" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "rewards_recipient_user_id_idx" ON "rewards" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "blockchain_transactions_campaign_id_idx" ON "blockchain_transactions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "blockchain_transactions_reward_id_idx" ON "blockchain_transactions" USING btree ("reward_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_campaign_id_idx" ON "ledger_entries" USING btree ("campaign_id");