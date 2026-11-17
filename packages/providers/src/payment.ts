/**
 * Mock payment provider (Phase 4). Per project constraints, no real
 * gateway (Razorpay or otherwise) is ever called — this interface exists
 * so a real provider can be dropped in later as a one-file change without
 * touching packages/orders or any Server Action. Do NOT read this as "the
 * project is Razorpay-integrated" — only a mock exists.
 *
 * Deliberately has zero dependency on @kisan4u/db: it only ever sees plain
 * numbers/strings supplied by the caller (packages/orders), which is the
 * only place server-side amounts are computed and persisted. This package
 * must never decide what a customer owes.
 */
export type MockPaymentOutcome = "SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS" | "PENDING";

export interface PaymentChargeRequest {
  /** Our own Payment.internalReference — never a raw database id. */
  internalReference: string;
  customerId: string;
  /** PaymentMethod value, kept as a plain string so this package doesn't
   * need a @kisan4u/db dependency just for one enum type. */
  method: string;
  amount: number;
}

export interface PaymentChargeResult {
  outcome: MockPaymentOutcome;
  providerReference: string;
  /** 0 on FAILURE/PENDING, the full requested amount on SUCCESS, half of
   * it on PARTIAL_SUCCESS (a dev-only simulation detail, not a business
   * rule — the actual advance amount owed is always computed by
   * packages/orders before this is ever called). */
  amountCaptured: number;
}

export interface PaymentProvider {
  /**
   * `simulate` lets dev/test code force a specific outcome for the same
   * request shape a real gateway callback would eventually produce.
   * Defaults to SUCCESS so normal manual testing doesn't need to pass it.
   */
  charge(
    request: PaymentChargeRequest,
    simulate?: MockPaymentOutcome,
  ): Promise<PaymentChargeResult>;
}

function mockProviderReference(): string {
  return `MOCKPAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export const mockPaymentProvider: PaymentProvider = {
  async charge(request, simulate = "SUCCESS") {
    const providerReference = mockProviderReference();
    console.log(
      `[mock-payment] charge ref=${request.internalReference} method=${request.method} amount=${request.amount} simulate=${simulate}`,
    );
    switch (simulate) {
      case "SUCCESS":
        return { outcome: "SUCCESS", providerReference, amountCaptured: request.amount };
      case "PARTIAL_SUCCESS":
        return {
          outcome: "PARTIAL_SUCCESS",
          providerReference,
          amountCaptured: Math.round(request.amount * 0.5 * 100) / 100,
        };
      case "FAILURE":
        return { outcome: "FAILURE", providerReference, amountCaptured: 0 };
      case "PENDING":
        return { outcome: "PENDING", providerReference, amountCaptured: 0 };
    }
  },
};
