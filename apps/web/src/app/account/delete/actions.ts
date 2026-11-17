"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@kisan4u/db";
import { requestOtp, verifyOtp } from "@kisan4u/auth";
import { finalizeAccountDeletion, requestAccountDeletion, restoreAccount } from "@kisan4u/orders";
import { currentClientIp } from "@/lib/client-ip";

async function currentUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

export async function sendDeletionOtpAction() {
  const userId = await currentUserId();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
  if (!user?.phone) redirect("/account/delete?error=phone");
  const sent = await requestOtp(user.phone, {
    purpose: "account_deletion",
    ip: await currentClientIp(),
  });
  if (sent.ok) redirect("/account/delete?otp=sent");
  if (sent.code === "RATE_LIMITED") {
    redirect(`/account/delete?error=rate&retryAfter=${sent.retryAfter}`);
  }
  redirect("/account/delete?error=sms");
}

async function submitDeletionAction(formData: FormData, immediate: boolean) {
  const userId = await currentUserId();
  const code = String(formData.get("code") ?? "").trim();
  const forfeitWalletBalance = formData.get("forfeitWalletBalance") === "true";
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
  const verified = user?.phone
    ? await verifyOtp(user.phone, code, {
        purpose: "account_deletion",
        ip: await currentClientIp(),
      })
    : null;
  if (!user?.phone || !/^\d{6}$/.test(code) || !verified?.ok) {
    redirect("/account/delete?otp=sent&error=otp");
  }
  const result = await requestAccountDeletion({ userId, immediate, forfeitWalletBalance });
  if (!result.ok) redirect("/account/delete?error=blocked");
  if (immediate) {
    const finalized = await finalizeAccountDeletion(userId);
    if (!finalized.ok) redirect("/account/delete?error=blocked");
    redirect("/api/session/revoke");
  }
  redirect("/account/delete?requested=1");
}

export async function requestDeletionAction(formData: FormData) {
  return submitDeletionAction(formData, false);
}

export async function deleteAccountNowAction(formData: FormData) {
  return submitDeletionAction(formData, true);
}

export async function restoreAccountAction() {
  const userId = await currentUserId();
  await restoreAccount(userId);
  redirect("/api/session/revoke");
}
