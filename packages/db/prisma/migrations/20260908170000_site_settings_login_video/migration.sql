-- Silent looping video behind the mobile app's login screen. NULL = the
-- app falls back to a branded gradient. Managed from /admin/app-login-video.
ALTER TABLE "SiteSettings" ADD COLUMN "loginVideoUrl" TEXT;
