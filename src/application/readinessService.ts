import { getPool } from "../infrastructure/db/pool";

export interface ReadinessResult {
  ready: boolean;
  reason?: string;
}

export interface ReadinessDependencies {
  checkDatabase: () => Promise<void>;
}

const defaultDependencies: ReadinessDependencies = {
  checkDatabase: async () => {
    await getPool().query("SELECT 1");
  },
};

/**
 * Ticket 17: is this service ready to serve traffic? Postgres is the only external dependency
 * this service has, so that's the only check today. `deps` is injectable (same pattern as
 * orderQuoteService's `readWarehouseCandidates`) so this is testable without taking a real
 * database down.
 */
export async function checkReadiness(deps: ReadinessDependencies = defaultDependencies): Promise<ReadinessResult> {
  try {
    await deps.checkDatabase();
    return { ready: true };
  } catch {
    return { ready: false, reason: "database unavailable" };
  }
}
