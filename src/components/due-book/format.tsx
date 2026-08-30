import type { ServiceItem, Status } from "@/lib/engine";

export const tk = (n: number) => `Tk ${Math.round(n).toLocaleString("en-US")}`;
export const tkS = (n: number) => Math.round(n).toLocaleString("en-US");
export const km = (n: number) => Math.round(n).toLocaleString("en-US");

const STATUS_LABEL: Record<Status, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  fine: "Fine",
};

export function daysText(status: Status, d: number | null) {
  if (d == null || !Number.isFinite(d)) return "no date";
  if (status === "overdue")
    return `${Math.abs(d)} ${Math.abs(d) === 1 ? "day" : "days"} late`;
  if (d === 0) return "today";
  return `in ${d} ${d === 1 ? "day" : "days"}`;
}

export function Chip({
  status,
  days,
  children,
}: {
  status: Status;
  days?: number | null;
  children?: React.ReactNode;
}) {
  return (
    <span className={`chip ${status}`}>
      <span className="dot" />
      {children ?? (
        <>
          {STATUS_LABEL[status]}
          {days === undefined ? "" : ` · ${daysText(status, days)}`}
        </>
      )}
    </span>
  );
}

export const Plate = ({ children }: { children: React.ReactNode }) => (
  <span className="plate">{children}</span>
);

export function ruleLabel(it: ServiceItem) {
  if (it.rule === "fixed_date") return "fixed date";
  if (it.rule === "period_months") return `every ${it.every_months} mo`;
  return `every ${km(it.every_km ?? 0)} km`;
}
