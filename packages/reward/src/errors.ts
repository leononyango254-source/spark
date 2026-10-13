export class RewardEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RewardEngineError";
  }
}
