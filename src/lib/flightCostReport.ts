/** "MM/YYYY" → first/last ISO day of that month, or null when invalid. */
export function monthBounds(text: string): { from: string; to: string } | null {
  const m = text.match(/^(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const mo = Number(m[1]), y = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[2]}-${m[1]}-01`, to: `${m[2]}-${m[1]}-${String(last).padStart(2, "0")}` };
}
