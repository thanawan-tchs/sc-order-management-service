import { afterAll, describe, expect, it } from "vitest";
import { closePool } from "../infrastructure/db/pool";
import { checkReadiness } from "./readinessService";

afterAll(async () => {
  await closePool();
});

describe("checkReadiness", () => {
  it("reports ready when the database check succeeds", async () => {
    const result = await checkReadiness({ checkDatabase: async () => undefined });

    expect(result).toEqual({ ready: true });
  });

  it("reports not ready, with a reason, when the database check fails — without leaking the underlying error", async () => {
    const result = await checkReadiness({
      checkDatabase: async () => {
        throw new Error("connection refused at db.internal:5432, password=hunter2");
      },
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toBe("database unavailable");
    expect(result.reason).not.toContain("hunter2");
  });

  it("uses the real database by default (no override) and reports ready against the live test DB", async () => {
    const result = await checkReadiness();

    expect(result).toEqual({ ready: true });
  });
});
