import { formatDistanceToNow, differenceInCalendarDays } from "date-fns";
import { pt } from "date-fns/locale";

function toDate(d: string | Date): Date {
  return d instanceof Date ? d : new Date(d);
}

/**
 * Portuguese relative time label.
 *  - same calendar day → "hoje"
 *  - otherwise → "há 3 dias", "há 1 semana", ...
 */
export function relativeLabelPT(d: string | Date): string {
  const date = toDate(d);
  if (isNaN(date.getTime())) return "—";
  const days = Math.abs(differenceInCalendarDays(new Date(), date));
  if (days === 0) return "hoje";
  return `há ${formatDistanceToNow(date, { locale: pt })}`;
}

/** Absolute date for tooltip (YYYY-MM-DD). */
export function absoluteLabel(d: string | Date): string {
  const date = toDate(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toISOString().slice(0, 10);
}

/** Colour bucket for task age (created date). 7 / 14 day thresholds. */
export function relativeColorClass(d: string | Date): string {
  const date = toDate(d);
  if (isNaN(date.getTime())) return "text-muted-foreground";
  const days = Math.abs(differenceInCalendarDays(new Date(), date));
  if (days <= 7) return "text-success";
  if (days <= 14) return "text-warning";
  return "text-danger";
}

/** Colour bucket for last CS activity. 7 / 30 day thresholds. */
export function activityColorClass(d: string | Date | null | undefined): string {
  if (!d) return "text-danger";
  const date = toDate(d);
  if (isNaN(date.getTime())) return "text-danger";
  const days = Math.abs(differenceInCalendarDays(new Date(), date));
  if (days <= 7) return "text-success";
  if (days <= 30) return "text-warning";
  return "text-danger";
}
