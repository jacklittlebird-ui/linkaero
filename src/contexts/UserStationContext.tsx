import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";
import { useChannel } from "./ChannelContext";
import {
  readCachedProfile,
  isCachedProfileFresh,
  writeCachedProfile,
} from "@/lib/profileCache";

interface UserStationContextType {
  station: string | null;       // e.g. "HBE", "CAI" — null = no restriction (admin or not set)
  isStationScoped: boolean;     // true when filters should auto-apply
  loading: boolean;
}

const UserStationContext = createContext<UserStationContextType | undefined>(undefined);

export function UserStationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { isAdmin } = useChannel();
  const [station, setStation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setStation(null);
      setLoading(false);
      return;
    }

    // 1) Hydrate instantly from localStorage if present.
    const cached = readCachedProfile(user.id);
    if (cached) {
      setStation(cached.station ?? null);
      setLoading(false);
    }

    // 2) If cache is fresh, skip the network round-trip entirely.
    //    profiles.station is virtually static per user; it was the #6 slowest
    //    query at ~12k calls. A 45-min TTL eliminates the chatter.
    if (cached && isCachedProfileFresh(user.id)) return;

    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("station, full_name")
        .eq("user_id", user.id)
        .maybeSingle();
      const nextStation = data?.station ?? null;
      setStation(nextStation);
      setLoading(false);
      writeCachedProfile(user.id, { station: nextStation, full_name: data?.full_name ?? null });
    })();
  }, [user]);


  // Admins and central review/finance channels (operations, receivables, payables,
  // general_accounts, contracts) see flights across all stations. Only station/clearance
  // operational channels are scoped to the user's profile station.
  const { activeChannel } = useChannel();
  // Clearance team enters flights for all stations, so they must see every record
  // (not just the user's home station). Same for central review/finance channels.
  const centralChannels = new Set(["clearance", "operations", "receivables", "payables", "general_accounts", "treasury", "contracts", "admin"]);
  const isStationScoped = !isAdmin && !!station && !centralChannels.has(activeChannel);

  return (
    <UserStationContext.Provider value={{ station, isStationScoped, loading }}>
      {children}
    </UserStationContext.Provider>
  );
}

export function useUserStation() {
  const ctx = useContext(UserStationContext);
  if (!ctx) throw new Error("useUserStation must be used within UserStationProvider");
  return ctx;
}
