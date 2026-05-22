/** Whether a trainer document has bookable schedule slots in payload shape. */
export function trainerHasOpenSlots(slots: unknown): boolean {
  if (Array.isArray(slots) && slots.length > 0) {
    return slots.some((entry) => {
      const row = entry as { slots?: unknown[]; start_time?: string };
      if (Array.isArray(row.slots) && row.slots.length > 0) return true;
      return Boolean(row.start_time);
    });
  }
  return false;
}
