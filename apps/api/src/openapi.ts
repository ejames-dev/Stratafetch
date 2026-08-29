import { z } from "zod";
import {
  collectionRequestSchema,
  fetchRequestSchema,
  searchRequestSchema,
  shapeRequestSchema,
  surveyRequestSchema,
} from "@stratafetch/contracts";

const body = (schema: string) => ({
  required: true,
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
  },
});
const accepted = { description: "Accepted" };
const ok = { description: "Successful response" };

export function buildOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Stratafetch API",
      version: "1.0.0-alpha.1",
      description: "Self-hosted web data operations API",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: {
        FetchRequest: z.toJSONSchema(fetchRequestSchema),
        SurveyRequest: z.toJSONSchema(surveyRequestSchema),
        CollectionRequest: z.toJSONSchema(collectionRequestSchema),
        SearchRequest: z.toJSONSchema(searchRequestSchema),
        ShapeRequest: z.toJSONSchema(shapeRequestSchema),
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/v1/fetch": {
        post: {
          summary: "Fetch one HTML page or PDF",
          requestBody: body("FetchRequest"),
          responses: { "200": ok },
        },
      },
      "/v1/surveys": {
        post: {
          summary: "Queue a URL discovery survey",
          requestBody: body("SurveyRequest"),
          responses: { "202": accepted },
        },
      },
      "/v1/surveys/{id}": {
        get: {
          summary: "Get a survey",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: { "200": ok },
        },
      },
      "/v1/surveys/{id}/urls": {
        get: {
          summary: "List discovered survey URLs",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: { "200": ok },
        },
      },
      "/v1/collections": {
        post: {
          summary: "Queue retrieval for surveyed or explicit URLs",
          requestBody: body("CollectionRequest"),
          responses: { "202": accepted },
        },
      },
      "/v1/collections/{id}": {
        get: {
          summary: "Get a collection",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: { "200": ok },
        },
      },
      "/v1/collections/{id}/pages": {
        get: {
          summary: "List collection pages",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: { "200": ok },
        },
      },
      "/v1/search": {
        post: {
          summary: "Search through Brave Search",
          requestBody: body("SearchRequest"),
          responses: { "200": ok },
        },
      },
      "/v1/shapes": {
        post: {
          summary: "Queue schema-validated OpenAI extraction",
          requestBody: body("ShapeRequest"),
          responses: { "202": accepted },
        },
      },
      "/v1/shapes/{id}": {
        get: { summary: "Get a Shape operation", responses: { "200": ok } },
      },
      "/v1/operations": {
        get: { summary: "List operations", responses: { "200": ok } },
      },
      "/v1/operations/{id}": {
        get: { summary: "Get an operation", responses: { "200": ok } },
        delete: {
          summary: "Delete an operation and stored results",
          responses: { "204": { description: "Deleted" } },
        },
      },
      "/v1/operations/{id}/cancel": {
        post: {
          summary: "Request cooperative cancellation",
          responses: { "200": ok },
        },
      },
      "/v1/operations/{id}/export": {
        get: {
          summary: "Export JSON, JSONL, or Markdown",
          responses: { "200": ok },
        },
      },
      "/health": {
        get: { summary: "Liveness", security: [], responses: { "200": ok } },
      },
      "/health/ready": {
        get: {
          summary: "Check database and Redis readiness",
          security: [],
          responses: { "200": ok, "503": { description: "Not ready" } },
        },
      },
    },
  };
}
