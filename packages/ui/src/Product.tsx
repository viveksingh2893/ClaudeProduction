export function PriceDisplay({
  price,
  originalPrice,
  size = "md",
  className = "",
}: {
  price: string | number;
  originalPrice?: string | number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClass = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <span className={`font-extrabold text-green-700 ${sizeClass}`}>₹{price}</span>
      {originalPrice ? (
        <span className="text-sm text-gray-400 line-through">₹{originalPrice}</span>
      ) : null}
    </div>
  );
}

/** Controlled +/- stepper. Handlers are supplied by the client component that owns the quantity state (cart row, product detail, ...). */
export function QuantitySelector({
  value,
  onDecrease,
  onIncrease,
  min = 1,
  max,
  disabled = false,
}: {
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-md border-[1.5px] border-border">
      <button
        type="button"
        onClick={onDecrease}
        disabled={disabled || value <= min}
        className="flex h-9 w-9 items-center justify-center text-base font-bold text-ink disabled:opacity-40"
        aria-label="Decrease quantity"
      >
        −
      </button>
      <span className="w-8 text-center text-sm font-bold text-ink" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={onIncrease}
        disabled={disabled || (max !== undefined && value >= max)}
        className="flex h-9 w-9 items-center justify-center text-base font-bold text-ink disabled:opacity-40"
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}
