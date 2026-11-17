import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type SplashReadyValue = {
  welcomeReady: boolean;
  markWelcomeReady: () => void;
};

const SplashReadyContext = createContext<SplashReadyValue | null>(null);

export function SplashReadyProvider({ children }: { children: ReactNode }) {
  const [welcomeReady, setWelcomeReady] = useState(false);
  const markWelcomeReady = useCallback(() => setWelcomeReady(true), []);
  const value = useMemo(() => ({ welcomeReady, markWelcomeReady }), [welcomeReady, markWelcomeReady]);
  return <SplashReadyContext.Provider value={value}>{children}</SplashReadyContext.Provider>;
}

export function useSplashReady() {
  const value = useContext(SplashReadyContext);
  if (!value) throw new Error("useSplashReady must be used inside SplashReadyProvider");
  return value;
}
