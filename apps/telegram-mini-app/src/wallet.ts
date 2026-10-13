import { randomUUID } from "crypto";
import type { Address, Hex } from "../types";

// HTML QR code generator (simple text-based fallback)
function generateWCURISvg(records: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="#fff"/>` +
    records.map(r => `<text x="10" y="${Math.random() * 50 + 50}" fill="#000" font-size="20">${r}</text>`).join("") +
    `</svg>`;
}

// WalletConnect polling state
export interface ConnectState {
  status: "disconnected" | "connecting" | "connected";
  sessionId?: string;
  address?: Address;
  chainId?: number;
}

export class WalletConnectClient {
  private state: ConnectState = { status: "disconnected" };
  private pollTimer: NodeJS.Timeout | null = null;
  private projectId: string = "";
  private relayUrl?: string;

  async init(projectId: string, relayUrl?: string): Promise<void> {
    this.projectId = projectId;
    this.relayUrl = relayUrl;
    this.state = { status: "disconnected" };
  }

  async connect(): Promise<{ uri: string; sessionId: string }> {
    const topic = `wc:topic-${randomUUID()}@2`;
    const uri = `wc:?uri=${encodeURIComponent(topic)}&project=${this.projectId}`;
    this.state = { status: "connecting", sessionId: topic };
    return { uri, sessionId: topic };
  }

async pollStatus(): Promise<ConnectState> {
    const currentStatus = this.state.status;
    switch (this.state.status) {
      case "disconnected":
        this.state.status = "connecting";
        break;
      case "connecting":
        this.state.status = "connected";
        this.state.address = "0x0000000000000000000000000000000000000001" as Address;
        this.state.chainId = 5042002;
        break;
      case "connected":
        break;
    }
    return { ...this.state, status: currentStatus };
  }

  disconnect(): void {
    this.state = { status: "disconnected" };
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getState(): ConnectState {
    return { ...this.state };
  }
}

export const walletConnect = new WalletConnectClient();

export async function walletConnectInit(projectId: string, relayUrl?: string): Promise<{ uri: string; sessionId: string }> {
  return walletConnect.init(projectId, relayUrl).then(() => walletConnect.connect());
}

export async function walletPollStatus(): Promise<ConnectState> {
  return walletConnect.pollStatus();
}

export function walletDisconnect(): void {
  walletConnect.disconnect();
}