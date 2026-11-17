import { QuantityInput } from "./QuantityInput";

type Props = {
  quantity: number;
  minQuantity: number;
  step?: number;
  maxQuantity?: number;
  onChange: (next: number) => void;
};

/**
 * Shared +/- quantity control for both customer and dealer product-detail
 * screens. Never lets quantity fall below minQuantity (dealer MOQ or 1)
 * and always moves in `step` increments, matching web's
 * dealer-add-to-cart-panel.tsx contract — this is a UX convenience only,
 * the server (validateCartLine) is the real enforcement.
 */
export function QuantityStepper({ quantity, minQuantity, step = 1, maxQuantity, onChange }: Props) {
  return (
    <QuantityInput
      quantity={quantity}
      minQuantity={minQuantity}
      maxQuantity={maxQuantity}
      step={step}
      onChange={onChange}
    />
  );
}
