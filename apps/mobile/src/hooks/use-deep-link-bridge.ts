import { useEffect, useRef } from "react";
import { router } from "expo-router";
import { useAuth } from "@/context/auth-context";

type BridgeContext = ReturnType<typeof useAuth> & {
  ensureGuest: () => Promise<boolean>;
};

export function useDeepLinkBridge(open: (context: BridgeContext) => void | Promise<void>) {
  const auth = useAuth();
  const started = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (auth.status === "loading" || started.current) return;
    started.current = true;
    const ensureGuest = async () => {
      if (auth.status !== "unauthenticated") return true;
      const ready = await auth.continueAsGuest();
      if (!ready) router.replace("/(auth)/welcome");
      return ready;
    };
    void openRef.current({ ...auth, ensureGuest });
  }, [auth]);
}
