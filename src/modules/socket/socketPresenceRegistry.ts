/** Lets HTTP handlers read the same trainer/trainee presence list as Socket.IO (in-memory). */
let snapshotProvider: (() => any[]) | null = null;

export function registerTrainerTraineePresenceProvider(fn: () => any[]): void {
  snapshotProvider = fn;
}

export function getTrainerTraineePresenceSnapshot(): any[] {
  if (!snapshotProvider) return [];
  try {
    return snapshotProvider() || [];
  } catch {
    return [];
  }
}
