import { init as initSDK, retrieveLaunchParams } from "@telegram-apps/sdk";
import { type AuthResponse, authenticate, type VerifyResponse, verify as verifyApi } from "./api";
import { parseStartParam } from "./launch";

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
    `;

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
    state.auth = await authenticate(apiOrigin, raw, referral as any);
  } catch (e) {
    state.authError = (e as Error).message;
  } finally {
    state.authLoading = false;
  }

  render();
}

bootstrap();