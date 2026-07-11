import type { CollectionPageRecord, CollectionRecord, CollectionRequest } from "@stratafetch/contracts";
import { AppError } from "../errors.js";
import { assertSafeHttpUrl } from "../security/url-policy.js";
import type { CollectionJobQueue } from "./queue.js";
import type { CollectionRepository } from "./repository.js";

export interface CollectionService {
  create(request: CollectionRequest): Promise<CollectionRecord>;
  get(id: string): Promise<CollectionRecord>;
  listPages(id: string): Promise<CollectionPageRecord[]>;
}
export class DefaultCollectionService implements CollectionService {
  constructor(
    private readonly repository: CollectionRepository,
    private readonly queue: CollectionJobQueue
  ) {}

  async create(request: CollectionRequest): Promise<CollectionRecord> {
    await assertSafeHttpUrl(request.startUrl);
    const collection = await this.repository.create(request);
    try {
      await this.queue.enqueue(collection.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The collection could not be queued.";
      await this.repository.markFailed(collection.id, message);
      throw new AppError("The collection could not be queued.", 503, "QUEUE_UNAVAILABLE");
    }
    return collection;
  }

  async get(id: string): Promise<CollectionRecord> {
    const collection = await this.repository.get(id);
    if (!collection) throw new AppError("Collection not found.", 404, "COLLECTION_NOT_FOUND");
    return collection;
  }

  async listPages(id: string): Promise<CollectionPageRecord[]> {
    await this.get(id);
    return this.repository.listPages(id);
  }
}
