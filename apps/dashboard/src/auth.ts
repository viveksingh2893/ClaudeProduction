import NextAuth from "next-auth";
import { passwordCredentialsProvider } from "@kisan4u/auth";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [passwordCredentialsProvider],
});
