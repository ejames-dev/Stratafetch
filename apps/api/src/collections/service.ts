import type { CollectionRequest } from "@stratafetch/contracts";
import { AppError } from "../errors.js";
import type { OperationRepository } from "../operations/repository.js";
import type { OperationJobQueue } from "../operations/queue.js";
import type { SurveyRepository } from "../surveys/repository.js";
import { assertSafeHttpUrl } from "../security/url-policy.js";
import { PostgresCollectionRepository } from "./repository.js";
export class CollectionService {
  constructor(
    private readonly repo: PostgresCollectionRepository,
    private readonly surveys: SurveyRepository,
    private readonly operations: OperationRepository,
    private readonly queue: OperationJobQueue,
  ) {}
  async create(request: CollectionRequest, idempotencyKey?: string) {
    let count: number;
    if (request.source.type === "survey") {
      const survey = await this.surveys.get(request.source.surveyId);
      if (!survey)
        throw new AppError("Survey not found.", 404, "SURVEY_NOT_FOUND");
      count = await this.surveys.countUrls(survey.id);
    } else {
      for (const url of request.source.urls) await assertSafeHttpUrl(url);
      count = request.source.urls.length;
    }
    const created = await this.operations.create("collection", request, {
      idempotencyKey,
    });
    const operation = created.operation;
    if (!created.isNew)
      return {
        operation,
        collection: await this.repo.getByOperationId(operation.id),
      };
    const collection = await this.repo.create(operation.id, request, count);
    await this.queue.enqueue({
      operationId: operation.id,
      type: "collection",
      resourceId: collection.id,
    });
    return { operation, collection };
  }
  async get(id: string) {
    const item = await this.repo.get(id);
    if (!item)
      throw new AppError("Collection not found.", 404, "COLLECTION_NOT_FOUND");
    return item;
  }
  async pages(id: string, limit: number, cursor?: string) {
    await this.get(id);
    return this.repo.listPages(id, limit, cursor);
  }
}
