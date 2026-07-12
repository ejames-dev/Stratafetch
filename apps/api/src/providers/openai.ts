import Ajv from "ajv/dist/2020.js";
import { AppError } from "../errors.js";
interface Validator {
  (value: unknown): boolean;
  errors?: unknown;
}
const AjvConstructor = Ajv as unknown as new (
  options?: Record<string, unknown>,
) => {
  compile(schema: object): Validator;
  errorsText(errors?: unknown): string;
};

interface OpenAIResponse {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: Record<string, unknown>;
  error?: { message?: string };
}
export class OpenAIShapeProvider {
  private readonly ajv = new AjvConstructor({ strict: false, allErrors: true });
  constructor(
    private readonly apiKey?: string,
    private readonly model?: string,
  ) {}
  get configured() {
    return Boolean(this.apiKey && this.model);
  }
  async shape(
    content: string,
    schema: Record<string, unknown>,
    instructions?: string,
  ) {
    if (!this.apiKey || !this.model)
      throw new AppError(
        "OpenAI Shape is not configured.",
        503,
        "PROVIDER_NOT_CONFIGURED",
      );
    const validate = this.ajv.compile(schema);
    let feedback = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          instructions:
            instructions ??
            "Extract the requested structured data from the supplied content.",
          input: `${content}${feedback}`,
          text: {
            format: {
              type: "json_schema",
              name: "stratafetch_shape",
              strict: true,
              schema,
            },
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const payload = (await response.json()) as OpenAIResponse;
      if (!response.ok)
        throw new AppError(
          payload.error?.message ?? `OpenAI returned HTTP ${response.status}.`,
          502,
          "PROVIDER_ERROR",
        );
      const part = payload.output
        ?.flatMap((item) => item.content ?? [])
        .find((item) => item.type === "output_text" || item.type === "refusal");
      if (part?.refusal)
        throw new AppError(part.refusal, 422, "PROVIDER_REFUSAL");
      if (!part?.text)
        throw new AppError(
          "OpenAI returned no structured output.",
          502,
          "PROVIDER_ERROR",
        );
      let value: unknown;
      try {
        value = JSON.parse(part.text);
      } catch {
        feedback =
          "\nThe previous response was not valid JSON. Return only schema-valid JSON.";
        continue;
      }
      if (validate(value)) return { value, usage: payload.usage ?? {} };
      feedback = `\nCorrect these validation errors: ${this.ajv.errorsText(validate.errors)}`;
    }
    throw new AppError(
      "OpenAI could not produce schema-valid output after three attempts.",
      422,
      "SHAPE_VALIDATION_FAILED",
    );
  }
}
