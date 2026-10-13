import { init as initSDK, retrieveLaunchParams } from "@telegram-apps/sdk";
import { type AuthResponse, authenticate, type VerifyResponse, verify as verifyApi } from "./api";
import { parseStartParam } from "./launch";
import { walletConnectInit, walletPollStatus, walletDisconnect, type ConnectState } from "./wallet";

const apiOrigin = import.meta.env.VITE_API_ORIGIN;
if (!apiOrigin) throw new Error("VITE_API_ORIGIN not set");

interface AppState {
  auth: AuthResponse | null;
  launch: { publicId: string; referralCode?: string } | null;
  verify: VerifyResponse | null;
  authLoading: boolean;
  authError: string | null;
}

const state: AppState = {
  auth: null,
  launch: null,
  verify: null,
  authLoading: true,
  authError: null,
};

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;

  const auth = state.auth;
  const launch = state.launch;
  const verifyResult = state.verify;

  if (state.authLoading) {
    app.innerHTML = '<div class="loading">Authenticating…</div>';
    return;
  }

  if (state.authError) {
    app.innerHTML = `<div class="error">Authentication failed: ${state.authError}</div>`;
    return;
  }

  if (!auth) {
    app.innerHTML = '<div class="loading">Authenticating…</div>';
    return;
  }

  if (!verifyResult) {
    app.innerHTML = `
      <div class="verify-screen">
        <h1>Verify Membership</h1>
        <p>Campaign: <strong>${launch?.publicId}</strong></p>
        <button id="verify-btn">
          Verify Channel Membership
        </button>
        <div id="verify-result"></div>
      </div>
      <div id="wallet-section" style="margin-top: 2rem; padding-top: 2rem; border-top: 1px solid #e0e0e0;">
        <h2>Wallet Connect</h2>
        <button id="connect-wallet-btn">Connect Wallet</button>
        <div id="wallet-status" style="margin: 1rem 0; font-size: 14px;"></div>
        <button id="disconnect-wallet-btn" style="display: none;">Disconnect</button>
      </div>
    `;

    const walletStatus = document.getElementById("wallet-status") as HTMLDivElement | null;
    const connectBtn = document.getElementById("connect-wallet-btn") as HTMLButtonElement | null;
    const disconnectBtn = document.getElementById("disconnect-wallet-btn") as HTMLButtonElement | null;

    if (connectBtn) {
      connectBtn.addEventListener("click", async () => {
        try {
          const { uri, sessionId } = await walletConnectInit("test-project-id", undefined);
          window.open(uri, "_blank");
          const pollInterval = setInterval(async () => {
            const status = await walletPollStatus();
            if (walletStatus) {
              walletStatus.textContent = `Status: ${status.status}`;
              if (status.status === "connected" && status.address) {
                if (disconnectBtn) disconnectBtn.style.display = "inline-block";
                walletStatus.textContent += ` - Address: ${status.address}`;
              } else {
                if (disconnectBtn) disconnectBtn.style.display = "none";
              }
            }
            if (status.status === "connected") clearInterval(pollInterval);
          }, 3000);
        } catch (e) {
          if (walletStatus) walletStatus.textContent = `Error: ${(e as Error).message}`;
        }
      });
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener("click", () => {
        walletDisconnect();
        if (walletStatus) walletStatus.textContent = "Status: disconnected";
        if (disconnectBtn) disconnectBtn.style.display = "none";
        if (connectBtn) connectBtn.style.display = "inline-block";
      });
    }

    const btn = document.getElementById("verify-btn") as HTMLButtonElement | null;
    const result = document.getElementById("verify-result");
    if (btn && result && launch) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Verifying…";
        try {
          const res = await verifyApi(apiOrigin, auth.token, launch.publicId, true);
          state.verify = res;
          if (res.verified) {
            result.textContent = "✅ Verified!";
            result.style.color = "green";
            btn.textContent = "Verified";
          } else {
            result.textContent = `❌ Not a member (status: ${res.memberStatus})`;
            result.style.color = "red";
            btn.disabled = false;
            btn.textContent = "Verify Channel Membership";
          }
        } catch (e) {
          result.textContent = `❌ Error: ${(e as Error).message}`;
          result.style.color = "red";
          btn.disabled = false;
          btn.textContent = "Verify Channel Membership";
        }
      });
    }
    return;
  }

  app.innerHTML = '<div class="success">✅ Access granted</div>';
}

async function bootstrap(): Promise<void> {
  try {
    initSDK();
  } catch (e) {
    console.error("[mini-app] SDK init failed:", e);
  }

  const launchParams = retrieveLaunchParams();
  const startParam = (launchParams.startParam as string) ?? "";
  state.launch = parseStartParam(startParam);

  try {
    const raw = (launchParams.initDataRaw as string) ?? "";
    const referral = state.launch
      ? { referralCode: state.launch.referralCode, campaignPublicId: state.launch.publicId }
      : undefined;
    // biome-ignore lint/suspicious/noExplicitAny: optional referral object shape
    state.auth = await authenticate(apiOrigin, raw, referral as any);
  } catch (e) {
    state.authError = (e as Error).message;
  } finally {
    state.authLoading = false;
  }

  render();
}

bootstrap();
