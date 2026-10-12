import {
  type Db,
  findReferral,
  type ReferralRow,
  referralCodes,
  updateReferralStatus,
  upsertReferralAttribution,
  users,
} from "@spark/db";
import { buildCampaignDeepLink } from "@spark/telegram";
import { and, eq } from "drizzle-orm";
import { ReferralError } from "./state";

export interface ReferralEngine {
  linkForReferrer(input: {
    campaignId: string;
    referrerUserId: string;
    publicId: string;
    referralCode: string;
  }): string;
  attribute(input: {
    campaignId: string;
    referrerUserId: string;
    referredUserId: string;
    referralCode: string;
  }): Promise<ReferralRow | null>;
  qualify(campaignId: string, referredUserId: string): Promise<ReferralRow>;
  getOrCreateReferralCode(
    db: Db,
    input: { campaignId: string; referrerUserId: string; generate: () => string },
  ): Promise<string>;
  findReferrerByCode(db: Db, campaignId: string, code: string): Promise<{ id: string } | null>;
}

export function createReferralEngine(deps: { db: Db }): ReferralEngine {
  const { db } = deps;

  function linkForReferrer(input: {
    campaignId: string;
    referrerUserId: string;
    publicId: string;
    referralCode: string;
  }): string {
    const startapp = `c_${input.publicId}_${input.referralCode}`;
    return buildCampaignDeepLink("sparkbot", "app", startapp);
  }

  async function attribute(input: {
    campaignId: string;
    referrerUserId: string;
    referredUserId: string;
    referralCode: string;
  }): Promise<ReferralRow | null> {
    if (input.referrerUserId === input.referredUserId) return null;
    return upsertReferralAttribution(db, {
      campaignId: input.campaignId,
      referrerUserId: input.referrerUserId,
      referredUserId: input.referredUserId,
      referralCode: input.referralCode,
    });
  }

  async function qualify(campaignId: string, referredUserId: string): Promise<ReferralRow> {
    const referral = await findReferral(db, campaignId, referredUserId);
    if (!referral) {
      throw new ReferralError("referral not found");
    }
    return updateReferralStatus(db, referral.id, "QUALIFIED", { qualifiedAt: new Date() });
  }

  async function getOrCreateReferralCode(
    db: Db,
    input: { campaignId: string; referrerUserId: string; generate: () => string },
  ): Promise<string> {
    const { campaignId, referrerUserId, generate } = input;

    const [existing] = await db
      .select({ code: referralCodes.code })
      .from(referralCodes)
      .where(
        and(
          eq(referralCodes.campaignId, campaignId),
          eq(referralCodes.referrerUserId, referrerUserId),
        ),
      )
      .limit(1);

    if (existing && existing.code) return existing.code;

    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generate();
      await db
        .insert(referralCodes)
        .values({
          campaignId,
          referrerUserId,
          code,
        })
        .onConflictDoNothing();

      const [row] = await db
        .select({ code: referralCodes.code })
        .from(referralCodes)
        .where(
          and(
            eq(referralCodes.campaignId, campaignId),
            eq(referralCodes.referrerUserId, referrerUserId),
          ),
        )
        .limit(1);

      if (row && row.code) return row.code;
    }

    throw new ReferralError(
      `failed to generate unique referral code after 10 attempts for campaign ${campaignId} and referrer ${referrerUserId}`,
    );
  }

  async function findReferrerByCode(
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

  return {
    linkForReferrer,
    attribute,
    qualify,
    getOrCreateReferralCode,
    findReferrerByCode,
  };
}
