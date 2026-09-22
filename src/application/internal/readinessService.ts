import { getPool } from "@infrastructure/db/pool";

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

export async function checkReadiness(deps: ReadinessDependencies = defaultDependencies): Promise<ReadinessResult> {
  try {
    await deps.checkDatabase();
    return { ready: true };
  } catch {
    return { ready: false, reason: "database unavailable" };
  }
}
