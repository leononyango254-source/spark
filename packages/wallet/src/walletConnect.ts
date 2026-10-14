import { SignClient } from "@walletconnect/sign-client";
import type { SignClientTypes } from "@walletconnect/types";
import type { Address, Hex, TransactionReceiptInfo, WalletProvider } from "./index";

type SignClientInstance = InstanceType<typeof SignClient>;

export interface WalletConnectConfig {
  projectId: string;
  relayUrl?: string;
  metadata: SignClientTypes.Metadata;
}

export interface PendingSession {
  sessionId: string;
  uri: string;
  topic: string;
}

export interface ApprovedSession {
  address: Address;
  chainId: number;
  topic: string;
}

export class WalletConnectSessionManager {
  private client: SignClientInstance;
  // biome-ignore lint/suspicious/noExplicitAny: test fakes construct via cast
  public static createForTest(client: SignClientInstance): WalletConnectSessionManager {
    return new WalletConnectSessionManager(client);
  }
  private pending = new Map<string, PendingSession>();
  private approved = new Map<string, ApprovedSession>();

  private constructor(client: SignClientInstance) {
    this.client = client;
    this.client.on("session_delete", (event: { topic: string }) => {
      this.approved.delete(event.topic);
    });
  }

  static async create(config: WalletConnectConfig): Promise<WalletConnectSessionManager> {
    const client = await SignClient.init({
      projectId: config.projectId,
      ...(config.relayUrl ? { relayUrl: config.relayUrl } : {}),
      metadata: config.metadata,
    });
    return new WalletConnectSessionManager(client);
  }

  async createSession(): Promise<PendingSession> {
    const { uri, topic } = (await this.client.connect({
      requiredNamespaces: {
        eip155: {
          methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"],
          chains: ["eip155:5042002"],
          events: ["chainChanged", "accountsChanged"],
        },
      },
    })) as unknown as { uri?: string; topic: string };
    if (!uri) throw new Error("WalletConnect: no URI returned");
    const sessionId = crypto.randomUUID();
    const pending: PendingSession = { sessionId, uri, topic };
    this.pending.set(sessionId, pending);
    return pending;
  }

  async waitForApproval(sessionId: string, timeoutMs = 300_000): Promise<ApprovedSession> {
    const pending = this.pending.get(sessionId);
    if (!pending) throw new Error("WalletConnect: unknown sessionId");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sessionId);
        reject(new Error("WalletConnect: approval timeout"));
      }, timeoutMs);

      const checkApproval = async () => {
        try {
          const session = this.client.session.get(pending.topic);
          if (session) {
            const account = session.namespaces.eip155?.accounts?.[0];
            if (account) {
              const address = account.split(":")[2] as Address;
              const chainId = Number(account.split(":")[1]);
              const approved: ApprovedSession = { address, chainId, topic: pending.topic };
              this.approved.set(sessionId, approved);
              this.pending.delete(sessionId);
              clearTimeout(timer);
              resolve(approved);
              return;
            }
          }
        } catch {
          // session not ready yet
        }
        setTimeout(checkApproval, 500);
      };
      checkApproval();
    });
  }

  async disconnect(sessionId: string): Promise<void> {
    const approved = this.approved.get(sessionId);
    if (approved) {
      await this.client.disconnect({ topic: approved.topic, reason: { code: 1, message: "user disconnected" } });
      this.approved.delete(sessionId);
    }
    this.pending.delete(sessionId);
  }

  getApproved(sessionId: string): ApprovedSession | null {
    return this.approved.get(sessionId) ?? null;
  }
}

export function createWalletConnectProvider(
  manager: WalletConnectSessionManager,
  sessionId: string,
): WalletProvider {
  return {
    get address(): Address {
      const approved = manager.getApproved(sessionId);
      if (!approved) throw new Error("WalletConnect: session not approved");
      return approved.address;
    },
    async getNonce(): Promise<number> {
      throw new Error("WalletConnect: getNonce not supported for user wallets");
    },
    async sendTransaction(): Promise<{ hash: Hex; nonce: number }> {
      throw new Error("WalletConnect: sendTransaction not supported for user wallets");
    },
    async getReceipt(): Promise<TransactionReceiptInfo | null> {
      throw new Error("WalletConnect: getReceipt not supported for user wallets");
    },
  };
}
