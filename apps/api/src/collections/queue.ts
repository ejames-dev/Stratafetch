import { Queue, type ConnectionOptions } from "bullmq";

export const collectionQueueName = "stratafetch-collections";

export interface CollectionJobData {
  collectionId: string;
}

export interface CollectionJobQueue {
  enqueue(collectionId: string): Promise<void>;
  close(): Promise<void>;
}

export function createRedisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: Number.isInteger(database) ? database : 0,
    maxRetriesPerRequest: null,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {})
  } satisfies ConnectionOptions;
}

export function createCollectionQueue(connection: ConnectionOptions): CollectionJobQueue {
  const queue = new Queue<CollectionJobData, void, "collect">(collectionQueueName, { connection });
  return {
    async enqueue(collectionId) {
      await queue.add("collect", { collectionId }, {
        jobId: collectionId,
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000
      });
    },
    async close() {
      await queue.close();
    }
  };
}
