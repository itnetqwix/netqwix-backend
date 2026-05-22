/**
 * PM2 cluster sets NODE_APP_INSTANCE (0, 1, 2, …).
 * Only the leader should run cron and background workers to avoid duplicate work.
 */
export function isClusterLeader(): boolean {
  if (process.env.RUN_BACKGROUND_JOBS === "false") return false;
  if (process.env.RUN_BACKGROUND_JOBS === "true") return true;
  const inst = process.env.NODE_APP_INSTANCE;
  if (inst === undefined || inst === "") return true;
  return inst === "0";
}

export function clusterInstanceLabel(): string {
  return process.env.NODE_APP_INSTANCE ?? "single";
}

/** PM2 `instances` from ecosystem / env (used for Socket.IO cluster safety checks). */
export function clusterInstanceCount(): number {
  const n = parseInt(String(process.env.PM2_INSTANCES ?? "1"), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
