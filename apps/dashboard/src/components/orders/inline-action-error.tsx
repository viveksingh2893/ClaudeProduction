import type { ReactNode } from "react";

/**
 * An action error shown inside an orders-table row (inline status / packing
 * controls). DataTable's actions cell is `whitespace-nowrap`, which this text
 * would inherit — a long server message then runs straight out of the table —
 * so wrapping is switched back on here and an over-long unbroken token (an
 * order number, a courier error code) is allowed to break.
 */
export function InlineActionError({ children }: { children: ReactNode }) {
  return (
    <span
      role="alert"
      className="mt-0.5 block max-w-[160px] whitespace-normal text-left text-[10px] leading-snug text-danger [overflow-wrap:anywhere]"
    >
      {children}
    </span>
  );
}
