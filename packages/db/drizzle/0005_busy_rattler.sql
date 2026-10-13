ALTER TABLE "users" ADD COLUMN "wallet_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_provider" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_status" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_chain_id" integer;
