/**
 * Integer micro-USDC money type. Money is ALWAYS a bigint of micro-USDC (6 decimals).
 * Never use floating point for money (PRD §80).
 */
export type MicroUsdc = bigint & { readonly __brand: "MicroUsdc" };

export const MICRO_USDC_DECIMALS = 6;
export const MICRO_PER_USDC = 1_000_000n;

export class MoneyError extends Error {
  override readonly name = "MoneyError";
}

/** Parse a decimal USDC string (e.g. "12.5") into micro-USDC. Integer only; no floats internally. */
export function usdcToMicro(value: string): MicroUsdc {
  const trimmed = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new MoneyError(`invalid decimal USDC amount: ${value}`);
  }
  const negative = match[1] === "-";
  const whole = BigInt(match[2] ?? "0");
  const fracRaw = match[3] ?? "";
  const fracPadded = `${fracRaw}000000`.slice(0, MICRO_USDC_DECIMALS);
  const micro = whole * MICRO_PER_USDC + BigInt(fracPadded);
  return (negative ? -micro : micro) as MicroUsdc;
}

/** Format micro-USDC as a decimal USDC string with 6 fractional digits. */
export function microToUsdc(micro: MicroUsdc): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / MICRO_PER_USDC;
  const frac = (abs % MICRO_PER_USDC).toString().padStart(MICRO_USDC_DECIMALS, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function addMicro(a: MicroUsdc, b: MicroUsdc): MicroUsdc {
  return (a + b) as MicroUsdc;
}

export function subtractMicro(a: MicroUsdc, b: MicroUsdc): MicroUsdc {
  return (a - b) as MicroUsdc;
}

export function assertNonNegative(amount: MicroUsdc): void {
  if (amount < 0n) {
    throw new MoneyError("amount must be non-negative");
  }
}
