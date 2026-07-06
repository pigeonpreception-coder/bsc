"use client";

export function PerformanceGauge({ score, label }: { score: number; label: string }) {
  const clampedScore = Math.min(Math.max(score, 0), 100);
  const circumference = 2 * Math.PI * 45;
  const dashOffset = circumference - (clampedScore / 100) * circumference;
  const color = clampedScore >= 90 ? "#1e8e3e" : clampedScore >= 70 ? "#e8a723" : "#d93025";

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-28 w-28">
        <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="#e5e7eb" strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold text-navy">{clampedScore.toFixed(0)}%</span>
        </div>
      </div>
      <p className="mt-1 text-xs font-medium text-gray-500">{label}</p>
    </div>
  );
}

export function ScoreCard({
  label,
  score,
  size = "normal",
}: {
  label: string;
  score: number | null;
  size?: "normal" | "small";
}) {
  const color =
    score === null
      ? "text-gray-400"
      : score >= 90
        ? "text-green-600"
        : score >= 70
          ? "text-amber-600"
          : "text-red-600";
  const textSize = size === "small" ? "text-lg" : "text-2xl";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className={`mt-1 font-bold ${textSize} ${color}`}>
        {score !== null ? `${score.toFixed(0)}%` : "—"}
      </p>
    </div>
  );
}

export function KpiStatusSummary({
  onTrack,
  atRisk,
  offTrack,
}: {
  onTrack: number;
  atRisk: number;
  offTrack: number;
}) {
  return (
    <div className="flex gap-6">
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-green-500" />
        <span className="text-sm text-gray-700">On Track: <strong>{onTrack}</strong></span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-amber-500" />
        <span className="text-sm text-gray-700">At Risk: <strong>{atRisk}</strong></span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-red-500" />
        <span className="text-sm text-gray-700">Off Track: <strong>{offTrack}</strong></span>
      </div>
    </div>
  );
}
