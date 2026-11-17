-- Push notifications: per-device Expo push tokens + an abandoned-cart
-- reminder cooldown marker. The in-app Notification feed already exists
-- (Notification table); this adds the delivery side (PushDevice) and the
-- cart-nudge bookkeeping (CartReminder). Push send itself is a graceful
-- no-op until EXPO_ACCESS_TOKEN / FCM credentials are configured.

-- Feed list query is "this user's rows, newest first" — index for it.
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx"
  ON "Notification" ("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "PushDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "pushToken" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'android',
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushDevice_pushToken_key"
  ON "PushDevice" ("pushToken");
CREATE INDEX IF NOT EXISTS "PushDevice_userId_idx"
  ON "PushDevice" ("userId");
DO $$ BEGIN
  ALTER TABLE "PushDevice"
    ADD CONSTRAINT "PushDevice_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "CartReminder" (
  "userId" TEXT NOT NULL,
  "lastRemindedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CartReminder_pkey" PRIMARY KEY ("userId")
);
DO $$ BEGIN
  ALTER TABLE "CartReminder"
    ADD CONSTRAINT "CartReminder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
