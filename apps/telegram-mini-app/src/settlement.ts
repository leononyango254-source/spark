import type { ConnectState } from "./wallet";

export interface SettlementState {
  status: "disconnected" | "connecting" | "connected" | "submitting" | "settled";
  walletAddress?: string;
  txHash?: string;
  settlementStatus: "pending" | "settled";
  error?: string;
}

export class SettlementClient {
  private state: SettlementState = {
    status: "disconnected",
    settlementStatus: "pending",
  };
  private pollTimer: NodeJS.Timeout | null = null;

  async init(): Promise<void> {
    this.state = {
      status: "disconnected",
      settlementStatus: "pending",
    };
  }

  async submitPayout(amount: string): Promise<{ txHash: string }> {
    this.state = {
      ...this.state,
      status: "submitting",
      error: undefined,
    };

    const res = await fetch("/api/settlement/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount }),
    });

    const data = await res.json();
    if (!res.ok) {
      this.state = {
        ...this.state,
        status: "disconnected",
        error: data.error || "Submission failed",
      };
      throw new Error(data.error || "Submission failed");
    }

    this.state = {
      ...this.state,
      status: "connected",
      txHash: data.txHash,
    };
    return { txHash: data.txHash };
  }

  async pollStatus(): Promise<SettlementState> {
    if (!this.state.txHash) return this.state;

    const res = await fetch(`/api/settlement/status/${this.state.txHash}`);
    const data = await res.json();

    if (data.status === "settled") {
      this.state = {
        ...this.state,
        status: "settled",
        settlementStatus: "settled",
      };
    } else {
      this.state = {
        ...this.state,
        settlementStatus: "pending",
        error: undefined,
      };
    }
    return this.state;
  }

  disconnect(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.state = {
      status: "disconnected",
      settlementStatus: "pending",
      txHash: undefined,
      error: undefined,
    };
  }

  getState(): SettlementState {
    return { ...this.state };
  }
}

export const settlement = new SettlementClient();