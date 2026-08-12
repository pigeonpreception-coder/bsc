// Extracted out of questionnaire/actions.ts (a "use server" file, whose
// exports must all be async Server Actions — a sync helper can't live
// there and still be unit-testable) so this pure date-math has real
// coverage; see computePeriodEnd.test.ts.
export function computePeriodEnd(financialYearStart: string, years: number): string | null {
  if (!financialYearStart || !years) return null;
  const start = new Date(financialYearStart + "T00:00:00Z");
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(Date.UTC(start.getUTCFullYear() + years, start.getUTCMonth(), start.getUTCDate() - 1));
  return end.toISOString().slice(0, 10);
}
