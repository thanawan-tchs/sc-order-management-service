import { expect } from "chai";
import { checkReadiness } from "./readinessService";

describe("checkReadiness", () => {
  it("reports ready when the database check succeeds", async () => {
    const result = await checkReadiness({ checkDatabase: async () => undefined });

    expect(result).to.deep.equal({ ready: true });
  });

  it("reports not ready, with a reason, when the database check fails — without leaking the underlying error", async () => {
    const result = await checkReadiness({
      checkDatabase: async () => {
        throw new Error("connection refused at db.internal:5432, password=hunter2");
      },
    });

    expect(result.ready).to.equal(false);
    expect(result.reason).to.equal("database unavailable");
    expect(result.reason).to.not.include("hunter2");
  });
});
