import type { OperationRecord } from "@stratafetch/contracts";
import { AppError } from "../errors.js";

// Rebuild a synchronous capability's success envelope from a stored idempotent
// operation so an Idempotency-Key replay is shaped exactly like the original
// response rather than leaking the raw OperationRecord. `success` maps the stored
// result into the endpoint's envelope; a still-running or failed original surfaces
// a stable error instead of a mismatched body.
export function replayEnvelope<T>(
  operation: OperationRecord,
  success: (result: unknown) => T,
): T {
  if (operation.status === "completed") return success(operation.result);
  if (operation.error)
    throw new AppError(operation.error.message, 502, operation.error.code);
  throw new AppError(
    "The original request for this Idempotency-Key is still in progress.",
    409,
    "IDEMPOTENCY_IN_PROGRESS",
  );
}
