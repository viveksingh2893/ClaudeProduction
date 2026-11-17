"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Plus, ShieldPlus, UserPlus } from "lucide-react";

/**
 * "Add User" for the master directory — a customer/dealer/seller account
 * is always created by the person themselves (registration/onboarding
 * flow), never by an admin, so there is nothing generic to "add" here;
 * the only two account types an admin creates directly are an internal
 * employee (STAFF, via the existing /admin/employees create form) and a
 * Business Associate (no single-add mutation exists yet — BAs
 * self-register and an admin only approves/uploads in bulk, so this
 * links to the BA directory rather than inventing a new create flow).
 */
export function AddUserMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center gap-1.5 rounded-md bg-green-700 px-3 py-2 text-sm font-semibold text-white hover:bg-green-800"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add User
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-border bg-white py-1 shadow-lg">
          <Link
            href="/admin/employees"
            className="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-gray-50"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add employee
          </Link>
          <Link
            href="/admin/business-associates"
            className="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-gray-50"
          >
            <ShieldPlus className="h-4 w-4" aria-hidden="true" />
            Manage Business Associates
          </Link>
        </div>
      )}
    </div>
  );
}
