/**
 * Parse API datetime string. Backend sends UTC without timezone suffix;
 * JS treats those as local time. Treat missing tz as UTC for correct display.
 */
export function parseUtcDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date(NaN);
  return new Date(/[Zz]|[+-]\d{2}:\d{2}$/.test(dateStr) ? dateStr : dateStr + "Z");
}

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
    return `${parseUtcDate(dateFrom).toLocaleDateString()} – ${parseUtcDate(dateTo).toLocaleDateString()}`;
  }
  if (hasFrom) {
    return `From ${parseUtcDate(dateFrom).toLocaleDateString()}`;
  }
  return `Until ${parseUtcDate(dateTo!).toLocaleDateString()}`;
}
