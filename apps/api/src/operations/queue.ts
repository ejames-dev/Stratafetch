import { Queue, type ConnectionOptions } from "bullmq";
import type { OperationType } from "@stratafetch/contracts";
export const operationQueueName = "stratafetch-operations";
export interface OperationJobData {
  operationId: string;
  type: Extract<OperationType, "survey" | "collection" | "shape">;
  resourceId: string;
}
export interface OperationJobQueue {
  enqueue(data: OperationJobData): Promise<void>;
  ready(): Promise<void>;
  close(): Promise<void>;
}
export function createRedisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: Number.isInteger(db) ? db : 0,
    maxRetriesPerRequest: null,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  } satisfies ConnectionOptions;
}
export function createOperationQueue(
  connection: ConnectionOptions,
): OperationJobQueue {
  const queue = new Queue<OperationJobData, void, "run">(operationQueueName, {
    connection,
  });
  return {
    async enqueue(data) {
      await queue.add("run", data, {
        jobId: data.operationId,
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      });
    },
    async ready() {
      await queue.waitUntilReady();
    },
    async close() {
      await queue.close();
    },
  };
}
