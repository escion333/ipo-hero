import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { communityEnabled } from "./config";
import { getCommunityClient } from "./client";
import type { CommunityUser } from "./types";

type CommunityAuthContextValue = {
  user: CommunityUser | null;
  loading: boolean;
  enabled: boolean;
  error: string | null;
  signInWithX(): Promise<void>;
  signInWithEmail(email: string): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
};

const CommunityAuthContext = createContext<CommunityAuthContextValue | null>(null);

export function CommunityAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CommunityUser | null>(null);
  const [loading, setLoading] = useState(communityEnabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!communityEnabled) {
      setLoading(false);
      setUser(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setUser(await getCommunityClient().getCurrentUser());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load community session.");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    if (!communityEnabled) return undefined;
    const unsubscribe = getCommunityClient().onAuthStateChange((nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh]);

  const value = useMemo<CommunityAuthContextValue>(
    () => ({
      user,
      loading,
      enabled: communityEnabled,
      error,
      refresh,
      signInWithX: () => getCommunityClient().signInWithX(),
      signInWithEmail: (email: string) => getCommunityClient().signInWithEmail(email),
      signOut: () => getCommunityClient().signOut().then(refresh),
    }),
    [error, loading, refresh, user],
  );

  return (
    <CommunityAuthContext.Provider value={value}>{children}</CommunityAuthContext.Provider>
  );
}

export function useCommunityUser() {
  const value = useContext(CommunityAuthContext);
  if (!value) throw new Error("useCommunityUser must be used inside CommunityAuthProvider.");
  return value;
}
