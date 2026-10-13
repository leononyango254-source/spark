export function intervalToCron(seconds: number): string {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new Error("interval seconds must be a positive integer");
  }
  if (seconds < 60) {
    return `*/${seconds} * * * * *`;
  }
  if (seconds % 60 === 0) {
    return `*/${seconds / 60} * * * *`;
  }
  return "* * * * *";
}