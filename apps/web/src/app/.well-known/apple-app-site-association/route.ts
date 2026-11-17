import { NextResponse } from "next/server";

/**
 * iOS Universal Links association file. Must be served at
 * `/.well-known/apple-app-site-association` with `Content-Type:
 * application/json` and NO redirect — hence a route handler rather than a
 * static `.json` file (Next would 404 the extension-less path).
 *
 * `TEAMID.com.kisan4u.mobile` — replace TEAMID with the Apple Developer
 * team id once the iOS build is provisioned. `/r/*` are the BA referral
 * links that should open the app.
 */
export function GET() {
  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appID: "TEAMID.com.kisan4u.mobile",
          paths: ["/r/*"],
        },
      ],
    },
  };
  return NextResponse.json(body, {
    headers: { "content-type": "application/json" },
  });
}
