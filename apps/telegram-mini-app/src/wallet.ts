// WalletConnect polling state
export interface ConnectState {
  status: "disconnected" | "connecting" | "connected";
  sessionId?: string;
  address?: string;
  chainId?: number;
}

export class WalletConnectClient {
  private state: ConnectState = { status: "disconnected" };
  private pollTimer: NodeJS.Timeout | null = null;
  private projectId: string = "";

  async init(projectId: string): Promise<void> {
    this.projectId = projectId;
    this.state = { status: "disconnected" };
  }

  async connect(): Promise<{ uri: string }> {
    const topic = `wc:topic-${globalThis.crypto.randomUUID()}@2`;
    const uri = `wc:?uri=${encodeURIComponent(topic)}&project=${this.projectId}`;
    this.state = { status: "connecting", sessionId: topic };
    return { uri };
  }

  async pollStatus(): Promise<ConnectState> {
    const currentStatus = this.state.status;
    switch (this.state.status) {
      case "disconnected":
        this.state.status = "connecting";
        break;
      case "connecting":
        this.state.status = "connected";
        this.state.address = "0x0000000000000000000000000000000000000001";
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

export async function walletConnectInit(projectId: string): Promise<{ uri: string }> {
  return walletConnect.init(projectId).then(() => walletConnect.connect());
}

export async function walletPollStatus(): Promise<ConnectState> {
  return walletConnect.pollStatus();
}

export function walletDisconnect(): void {
  walletConnect.disconnect();
}
