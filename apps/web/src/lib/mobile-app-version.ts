function parts(version: string): number[] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

export function isMobileVersionAtLeast(version: string | null, minimum: string): boolean {
  if (!version) return false;
  const actual = parts(version);
  const required = parts(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index]! > required[index]!) return true;
    if (actual[index]! < required[index]!) return false;
  }
  return true;
}

export function usesGenericOtpFlow(headers: Pick<Headers, "get">): boolean {
  return isMobileVersionAtLeast(
    headers.get("x-app-version"),
    process.env.MOBILE_GENERIC_OTP_MIN_VERSION || "3.1.0",
  );
}
