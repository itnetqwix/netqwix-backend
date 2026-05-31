/**
 * Ephemeral in-call UX state (agenda focus, live notes, quality snapshots).
 * Cleared when the lesson timer ends; notes + summary are persisted to Mongo.
 */

export type LiveNoteEntry = {
  id: string;
  text: string;
  authorId: string;
  elapsedSeconds: number;
  createdAt: number;
  sharedWithTrainee: boolean;
};

export type QualitySnapshot = {
  overallScore: number | null;
  label: "good" | "fair" | "poor" | "unknown";
  rtt: number | null;
  updatedAt: number;
};

type SessionLiveState = {
  focusedClipId: string | null;
  focusedClipTitle: string | null;
  notes: LiveNoteEntry[];
  qualityByRole: {
    trainer: QualitySnapshot | null;
    trainee: QualitySnapshot | null;
  };
};

const liveBySession = new Map<string, SessionLiveState>();

function emptyState(): SessionLiveState {
  return {
    focusedClipId: null,
    focusedClipTitle: null,
    notes: [],
    qualityByRole: { trainer: null, trainee: null },
  };
}

function ensure(sessionId: string): SessionLiveState {
  const sid = String(sessionId);
  let row = liveBySession.get(sid);
  if (!row) {
    row = emptyState();
    liveBySession.set(sid, row);
  }
  return row;
}

export function clearLessonLiveState(sessionId: string): void {
  liveBySession.delete(String(sessionId));
}

export function setFocusedClip(
  sessionId: string,
  clipId: string | null,
  clipTitle?: string | null
): SessionLiveState {
  const row = ensure(sessionId);
  row.focusedClipId = clipId ? String(clipId) : null;
  row.focusedClipTitle = clipTitle ? String(clipTitle) : null;
  return row;
}

export function addLiveNote(
  sessionId: string,
  entry: Omit<LiveNoteEntry, "id" | "createdAt"> & { id?: string }
): LiveNoteEntry {
  const row = ensure(sessionId);
  const note: LiveNoteEntry = {
    id: entry.id ?? `${Date.now()}-${row.notes.length}`,
    text: String(entry.text ?? "").trim(),
    authorId: String(entry.authorId),
    elapsedSeconds: Math.max(0, Number(entry.elapsedSeconds) || 0),
    createdAt: Date.now(),
    sharedWithTrainee: !!entry.sharedWithTrainee,
  };
  if (note.text) row.notes.push(note);
  return note;
}

function bucketQuality(score: number | null | undefined): QualitySnapshot["label"] {
  if (score == null || Number.isNaN(score)) return "unknown";
  if (score >= 0.75) return "good";
  if (score >= 0.45) return "fair";
  return "poor";
}

export function updateQualitySnapshot(
  sessionId: string,
  role: "trainer" | "trainee",
  stats: { overallScore?: number; rtt?: number }
): QualitySnapshot {
  const row = ensure(sessionId);
  const snap: QualitySnapshot = {
    overallScore:
      stats.overallScore != null && Number.isFinite(stats.overallScore)
        ? stats.overallScore
        : null,
    label: bucketQuality(stats.overallScore),
    rtt:
      stats.rtt != null && Number.isFinite(stats.rtt) ? Math.round(stats.rtt) : null,
    updatedAt: Date.now(),
  };
  row.qualityByRole[role] = snap;
  return snap;
}

export function getLessonLiveStateSnapshot(
  sessionId: string,
  viewerRole: "trainer" | "trainee"
) {
  const row = liveBySession.get(String(sessionId)) ?? emptyState();
  const notes =
    viewerRole === "trainer"
      ? row.notes
      : row.notes.filter((n) => n.sharedWithTrainee);
  return {
    focusedClipId: row.focusedClipId,
    focusedClipTitle: row.focusedClipTitle,
    liveNotes: notes,
    quality: row.qualityByRole,
  };
}

export function drainLiveNotesForPersist(sessionId: string): LiveNoteEntry[] {
  const row = liveBySession.get(String(sessionId));
  if (!row) return [];
  return [...row.notes];
}
