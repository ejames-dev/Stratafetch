import type { SurveyRequest } from "@stratafetch/contracts";
import { AppError } from "../errors.js";
import type { OperationRepository } from "../operations/repository.js";
import type { OperationJobQueue } from "../operations/queue.js";
import { assertSafeHttpUrl } from "../security/url-policy.js";
import { SurveyRepository } from "./repository.js";
export class SurveyService {
  constructor(
    private readonly repo: SurveyRepository,
    private readonly operations: OperationRepository,
    private readonly queue: OperationJobQueue,
  ) {}
  async create(request: SurveyRequest, idempotencyKey?: string) {
    await assertSafeHttpUrl(request.startUrl);
    const created = await this.operations.create("survey", request, {
      idempotencyKey,
    });
    const operation = created.operation;
    if (!created.isNew)
      return {
        operation,
        surveyId: (await this.repo.getByOperationId(operation.id))?.id ?? null,
      };
    const surveyId = await this.repo.create(operation.id);
    await this.queue.enqueue({
      operationId: operation.id,
      type: "survey",
      resourceId: surveyId,
    });
    return { operation, surveyId };
  }
  async get(id: string) {
    const item = await this.repo.get(id);
    if (!item) throw new AppError("Survey not found.", 404, "SURVEY_NOT_FOUND");
    return item;
  }
  async urls(id: string, limit: number, cursor?: string) {
    await this.get(id);
    return this.repo.listUrls(id, limit, cursor);
  }
}
