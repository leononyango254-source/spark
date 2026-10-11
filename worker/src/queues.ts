export const QUEUES = {
  settlement: "settlement",
  reconciliation: "reconciliation",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
