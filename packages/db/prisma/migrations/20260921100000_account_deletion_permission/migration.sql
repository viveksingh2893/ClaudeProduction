-- Existing system roles need the new module grants before the dashboard
-- switches the deletion routes to fail-closed RBAC checks.
INSERT INTO "RolePermission" ("id", "roleId", "module", "action", "granted")
SELECT
  'account-deletions-' || r."id" || '-' || a."action"::text,
  r."id",
  'account-deletions',
  a."action"::"PermissionAction",
  TRUE
FROM "Role" r
CROSS JOIN (VALUES ('VIEW'), ('CREATE'), ('EDIT'), ('DELETE')) AS a("action")
WHERE r."isSystem" = TRUE
ON CONFLICT ("roleId", "module", "action")
DO UPDATE SET "granted" = TRUE;
