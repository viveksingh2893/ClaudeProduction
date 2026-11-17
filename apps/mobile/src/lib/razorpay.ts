import RazorpayCheckout from "react-native-razorpay";
import { Colors } from "@/constants/theme";

/**
 * Thin wrapper over react-native-razorpay's Standard Checkout — the mobile
 * counterpart of the `new window.Razorpay({...}).open()` call in
 * apps/web/src/app/checkout/checkout-form.tsx.
 *
 * UPI intent: Standard Checkout handles the app-switch to a UPI app
 * (Google Pay / PhonePe / Paytm) natively on Android the moment the
 * shopper picks one — no `method` restriction or extra config is needed
 * here. Leaving `method` unset keeps every option (UPI, cards, netbanking,
 * wallets) available; the seller's Razorpay account settings decide which
 * actually show.
 */

export type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export type RazorpayOpenResult =
  | { ok: true; data: RazorpaySuccess }
  | { ok: false; cancelled: boolean; message: string };

export async function openRazorpayCheckout(options: {
  keyId: string;
  orderId: string;
  amountPaise: number;
  name: string;
  description: string;
  prefillName?: string | null;
  prefillContact?: string | null;
  prefillEmail?: string | null;
  themeColor?: string;
}): Promise<RazorpayOpenResult> {
  try {
    const data = (await RazorpayCheckout.open({
      key: options.keyId,
      order_id: options.orderId,
      amount: options.amountPaise,
      currency: "INR",
      name: options.name,
      description: options.description,
      prefill: {
        name: options.prefillName || undefined,
        contact: options.prefillContact || undefined,
        email: options.prefillEmail || undefined,
      },
      theme: { color: options.themeColor ?? Colors.light.green700 },
      retry: { enabled: true, max_count: 1 },
    })) as RazorpaySuccess;

    return {
      ok: true,
      data: {
        razorpay_payment_id: data.razorpay_payment_id,
        razorpay_order_id: data.razorpay_order_id,
        razorpay_signature: data.razorpay_signature,
      },
    };
  } catch (e) {
    // The SDK rejects with { code, description } and, on newer versions,
    // sometimes a nested { error: { code, description, reason } }.
    const err = e as {
      code?: number;
      description?: string;
      error?: { code?: string; description?: string; reason?: string };
    };
    const message = err.error?.description ?? err.description ?? "Payment was not completed.";
    const cancelled =
      err.code === 2 || // Razorpay's PAYMENT_CANCELLED
      err.error?.reason === "payment_cancelled" ||
      /cancel/i.test(message);
    return { ok: false, cancelled, message };
  }
}
