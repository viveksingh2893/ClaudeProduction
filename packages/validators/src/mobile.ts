import { z } from "zod";

/** Bearer-token refresh — mobile-only, see packages/auth/src/mobile-tokens.ts. */
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Missing refresh token."),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
