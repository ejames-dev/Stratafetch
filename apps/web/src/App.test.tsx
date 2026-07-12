import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the secure login when no admin session exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /enter the control layer/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/administrator token/i)).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.getByText(/never stored in this browser/i),
    ).toBeInTheDocument();
  });
});
