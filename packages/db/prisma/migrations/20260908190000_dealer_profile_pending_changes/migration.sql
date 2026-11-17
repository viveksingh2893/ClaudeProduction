-- Proposed profile edits for an APPROVED dealer, awaiting a second admin
-- "Approve changes" action. NULL = nothing pending. See
-- packages/auth/src/access.ts (proposeDealerProfileChanges).
ALTER TABLE "DealerProfile" ADD COLUMN "pendingChanges" JSONB;
