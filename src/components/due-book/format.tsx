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

/**
 * A wa.me deep link — opens WhatsApp (app on a phone, web on a desktop) with
 * the message already typed, ready for the workshop to hit send. Nothing is
 * sent by us: no WhatsApp Business account, no API, no token.
 *
 * wa.me needs the number in international form, digits only — no +, no spaces,
 * no leading zero. Every owner on the books is a Bangladeshi mobile stored as
 * 11 digits starting 01 (013-019, all 677 of them), so dropping the 0 and
 * prefixing 880 is the whole conversion.
 */
// ponytail: one country, so the code is a constant. Store a country per owner
// if the workshop ever takes a customer from outside Bangladesh.
const BD_DIALLING_CODE = "880";

export function whatsappLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.startsWith(BD_DIALLING_CODE)
    ? digits
    : `${BD_DIALLING_CODE}${digits.replace(/^0+/, "")}`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

/** Anchor, not window.open: no popup blocker, and it opens the app on a phone. */
export function WhatsAppButton({
  phone,
  text,
  small,
  label = "Send on WhatsApp",
  onClick,
}: {
  phone: string;
  text: string;
  small?: boolean;
  label?: string;
  /** e.g. stopPropagation when the button sits inside a clickable row */
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <a
      className={`btn${small ? " sm" : ""}`}
      href={whatsappLink(phone, text)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.17 8.17 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.55-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.03s.87 2.35.99 2.51c.12.16 1.71 2.61 4.14 3.66.58.25 1.03.4 1.38.51.58.19 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.05.14-1.16-.06-.1-.22-.16-.47-.28z" />
      </svg>
      {label}
    </a>
  );
}
