/**
 * Format cleanup job date range for display.
 * Aligns with Cleanup History and Recent Cleanup Jobs blocks.
 */
export function formatCleanupDateRange(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): string {
  const hasFrom = !!dateFrom;
  const hasTo = !!dateTo;

  if (!hasFrom && !hasTo) {
    return "All dates";
  }
  if (hasFrom && hasTo) {
    return `${new Date(dateFrom).toLocaleDateString()} – ${new Date(dateTo).toLocaleDateString()}`;
  }
  if (hasFrom) {
    return `From ${new Date(dateFrom).toLocaleDateString()}`;
  }
  return `Until ${new Date(dateTo!).toLocaleDateString()}`;
}
