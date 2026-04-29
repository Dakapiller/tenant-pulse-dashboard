import { healthLevel, HEALTH_LEVEL_LABEL, type HealthLevel } from "@/lib/health";

interface HealthBadgeProps {
  score: number | null | undefined;
  showScore?: boolean;
  className?: string;
}

const STYLES: Record<HealthLevel, string> = {
  risk:    "bg-danger/10 text-danger",
  monitor: "bg-warning/15 text-warning",
  healthy: "bg-success/10 text-success",
};

/**
 * Single source of truth for rendering a club's health score.
 * Thresholds: 0–29 risk · 30–59 monitor · 60–100 healthy.
 */
export function HealthBadge({ score, showScore = true, className = "" }: HealthBadgeProps) {
  const hasScore = score !== null && score !== undefined && Number.isFinite(Number(score));
  const level = healthLevel(hasScore ? Number(score) : 100);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[level]} ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {HEALTH_LEVEL_LABEL[level]}
      {showScore && hasScore && <span className="tabular-nums">· {Math.round(Number(score))}</span>}
    </span>
  );
}
