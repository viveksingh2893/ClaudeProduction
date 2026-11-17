/**
 * Mockable service-provider interfaces from NEXTJS_ARCHITECTURE_PLAN.md
 * §10 — SMS, Email, Push, WhatsApp, Payment, File storage — each with a
 * local/console-log implementation only, per the original MVP-phase
 * constraint (no real credentials during the initial build). rapidshyp.ts
 * is the one deliberate exception — a real courier integration added
 * later, once real dispatch was actually needed; see its own doc comment.
 *
 * SMS (Phase 1), Payment and Logistics (Phase 4), and File storage are
 * implemented. Email, Push, WhatsApp remain for later phases (see
 * BUILD_PHASES.md).
 */
export * from "./sms";
export * from "./payment";
export * from "./logistics";
export * from "./storage";
export * from "./rapidshyp";
export * from "./delhivery";
export * from "./razorpay";
