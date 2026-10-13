ALTER TYPE "public"."referral_status" ADD VALUE 'ATTRIBUTED';--> statement-breakpoint
ALTER TYPE "public"."referral_status" ADD VALUE 'QUALIFIED';--> statement-breakpoint
ALTER TYPE "public"."referral_status" ADD VALUE 'REWARD_PENDING';--> statement-breakpoint
ALTER TYPE "public"."referral_status" ADD VALUE 'PAID';--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_codes_campaign_code_unique" UNIQUE("campaign_id","code"),
	CONSTRAINT "referral_codes_campaign_referrer_unique" UNIQUE("campaign_id","referrer_user_id")
);
--> statement-breakpoint
ALTER TABLE "referrals" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "max_participants" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "participant_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "qualified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_participant_count_non_negative" CHECK ("campaigns"."participant_count" >= 0);--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_participant_count_within_max" CHECK ("campaigns"."max_participants" IS NULL OR "campaigns"."participant_count" <= "campaigns"."max_participants");--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "reward_nonce_seq" START WITH 1000000;--> statement-breakpoint