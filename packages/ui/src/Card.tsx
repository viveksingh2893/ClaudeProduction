import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border border-border bg-surface ${className}`} {...props} />;
}

export function SummaryCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`p-5 sm:p-6 ${className}`}>
      <div className="mb-4 text-[15px] font-extrabold text-green-800">{title}</div>
      {children}
    </Card>
  );
}

/** Small feature-highlight tile — used for the "Bulk Pricing / Dedicated Manager / ..." benefit grids on registration pages. */
export function InfoCard({
  title,
  description,
  tone = "green",
}: {
  title: string;
  description: string;
  tone?: "green" | "earth";
}) {
  return (
    <Card className="p-4">
      <div className={`mb-1.5 text-sm font-bold ${tone === "earth" ? "text-earth-700" : "text-green-800"}`}>{title}</div>
      <p className="text-[13px] leading-relaxed text-gray-600">{description}</p>
    </Card>
  );
}
