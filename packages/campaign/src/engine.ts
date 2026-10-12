import {
  type CampaignRow,
  createMembershipTask,
  type Db,
  findCampaignById,
  createCampaign as insertCampaign,
  setCampaignFunded,
  updateCampaignConfig,
  updateCampaignStatus,
} from "@spark/db";
import { generatePublicId } from "@spark/domain";
import { assertCampaignTransition, CampaignError, type CampaignState } from "./state";

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
      assertCampaignTransition(campaign.status as CampaignState, "FUNDING");
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
