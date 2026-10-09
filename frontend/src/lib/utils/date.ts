/**
 * Format a date using the "Date Format" setting (Settings → Localization).
 *
 * Invoice issue/due dates are stored as UTC midnight, so by default the UTC
 * parts are used; otherwise browsers west of UTC would show the previous day.
 * Pass `utc = false` for real timestamps (e.g. updatedAt) to show local time.
 */
export function formatDate(
  d: string | Date | null | undefined,
  format: string = "YYYY-MM-DD",
  utc = true,
): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "";
  const year = utc ? dt.getUTCFullYear() : dt.getFullYear();
  const month = String((utc ? dt.getUTCMonth() : dt.getMonth()) + 1).padStart(2, "0");
  const day = String(utc ? dt.getUTCDate() : dt.getDate()).padStart(2, "0");
  if (format === "DD.MM.YYYY") {
    return `${day}.${month}.${year}`;
  }
  return `${year}-${month}-${day}`;
}
