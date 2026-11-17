import { formatCurrency } from "@kisan4u/ui";

export type AmountEquationInput = {
  prepaidAmount: string | number;
  codAmount: string | number;
  walletAmount: string | number;
  finalAmount: string | number;
  discountNote: string | number | null;
};

/**
 * "Prepaid ₹100 + COD ₹512.26 = ₹612.26" — omits zero terms (no wallet
 * used, or no COD leg for a fully-prepaid order) so the common case stays
 * short. Deliberately NOT a full pill (rounded-full) like StatusBadge —
 * this text is long enough on a partial-prepaid order that forcing it onto
 * one line was what made the orders table too wide to fit a normal desktop
 * screen without horizontal scrolling. A softly-rounded box that wraps
 * across 1-2 lines instead keeps the same "bubble" look at a fraction of
 * the column width.
 */
export function AmountEquationBubble({ equation }: { equation: AmountEquationInput }) {
  const { prepaidAmount, codAmount, walletAmount, finalAmount, discountNote } = equation;
  const terms: string[] = [];
  if (Number(prepaidAmount) > 0) terms.push(`Prepaid ${formatCurrency(prepaidAmount)}`);
  if (Number(codAmount) > 0) terms.push(`COD ${formatCurrency(codAmount)}`);
  let text = terms.join(" + ") || formatCurrency("0.00");
  if (Number(walletAmount) > 0) text += ` − Wallet ${formatCurrency(walletAmount)}`;
  text += ` = ${formatCurrency(finalAmount)}`;

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="max-w-[180px] rounded-md bg-info-bg px-2 py-1 text-right text-[10.5px] font-semibold leading-tight text-info">
        {text}
      </div>
      {discountNote != null && Number(discountNote) > 0 && (
        <span className="max-w-[180px] text-right text-[10px] leading-tight text-gray-400">
          ({formatCurrency(discountNote)} discount already applied)
        </span>
      )}
    </div>
  );
}
