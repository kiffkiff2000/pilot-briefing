import { extractRiskLevel } from "@/lib/briefing-utils";

type Props = {
  briefingText: string;
};

export function RiskBadge({ briefingText }: Props) {
  const level = extractRiskLevel(briefingText);

  const styles: Record<typeof level, string> = {
    CRITICAL: "border-red-300 bg-red-100 text-red-900",
    MAJOR: "border-orange-300 bg-orange-100 text-orange-900",
    MINOR: "border-green-300 bg-green-100 text-green-900",
  };

  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${styles[level]}`}
    >
      {level}
    </span>
  );
}
