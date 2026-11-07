/** Decodes the offset the mock encodes in cursors, only to number rows ("51–100 of 312"). */
export function cursorStart(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const s = atob(cursor);
    return s.startsWith("o:") ? Number(s.slice(2)) || 0 : 0;
  } catch {
    return 0;
  }
}
