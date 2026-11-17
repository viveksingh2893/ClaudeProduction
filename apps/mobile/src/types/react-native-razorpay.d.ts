/**
 * react-native-razorpay ships no type declarations. This covers exactly
 * the Standard Checkout surface src/lib/razorpay.ts uses. See
 * https://github.com/razorpay/react-native-razorpay.
 */
declare module "react-native-razorpay" {
  export interface RazorpayCheckoutOptions {
    key: string;
    amount: number | string;
    currency?: string;
    name?: string;
    description?: string;
    image?: string;
    order_id?: string;
    prefill?: { name?: string; email?: string; contact?: string };
    notes?: Record<string, string>;
    theme?: { color?: string; hide_topbar?: boolean };
    method?: Partial<Record<"upi" | "card" | "netbanking" | "wallet" | "emi" | "paylater", boolean>>;
    retry?: { enabled?: boolean; max_count?: number };
    modal?: { confirm_close?: boolean; ondismiss?: () => void };
  }

  export interface RazorpaySuccessResponse {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }

  export interface RazorpayErrorResponse {
    code?: number;
    description?: string;
    error?: { code?: string; description?: string; reason?: string; source?: string; step?: string };
  }

  const RazorpayCheckout: {
    open(options: RazorpayCheckoutOptions): Promise<RazorpaySuccessResponse>;
  };

  export default RazorpayCheckout;
}
