import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

export type Channel = "clearance" | "station" | "contracts" | "operations" | "receivables" | "payables" | "general_accounts" | "treasury" | "admin";

export const CHANNEL_LABELS: Record<Channel, string> = {
  clearance: "Clearance",
  station: "Station",
  contracts: "Contracts",
  operations: "Operations",
  receivables: "Receivables",
  payables: "Payables",
  general_accounts: "General Accounts",
  treasury: "Treasury",
  admin: "Management",
};

export const CHANNEL_DESCRIPTIONS: Record<Channel, string> = {
  clearance: "Flight schedule entry & permit management",
  station: "Service delivery & reporting",
  contracts: "Service pricing & contract management",
  operations: "Monitor, review & approve station reports",
  receivables: "Invoice generation & client billing",
  payables: "Vendor invoices & third-party payments",
  treasury: "Cash, bank & treasury vouchers",
  general_accounts: "Full payables, accounting & receivables (read-only)",
  admin: "Full system administration",
};

// Map DB roles to channels
function rolesToChannels(roles: string[]): Channel[] {
  const channels: Channel[] = [];
  if (roles.includes("admin")) return ["admin", "clearance", "station", "contracts", "operations", "receivables", "payables", "general_accounts", "treasury"];
  if (roles.includes("clearance")) channels.push("clearance");
  if (roles.includes("station_manager") || roles.includes("station_ops") || roles.includes("employee")) channels.push("station");
  if (roles.includes("contracts")) channels.push("contracts");
  if (roles.includes("operations")) channels.push("operations");
  if (roles.includes("receivables")) channels.push("receivables");
  if (roles.includes("payables")) channels.push("payables");
  if (roles.includes("general_accounts") || roles.includes("accountant")) channels.push("general_accounts");
  if (roles.includes("treasury")) channels.push("treasury");
  if (roles.includes("viewer") && channels.length === 0) channels.push("general_accounts");
  return channels.length > 0 ? channels : ["station"]; // default fallback
}

interface ChannelContextType {
  channels: Channel[];
  activeChannel: Channel;
  setActiveChannel: (c: Channel) => void;
  loading: boolean;
  userRoles: string[];
  isAdmin: boolean;
}

const ChannelContext = createContext<ChannelContextType | undefined>(undefined);

import { readCachedRoles, writeCachedRoles, clearCachedRoles, isCachedRolesFresh } from "@/lib/roleCache";

// Re-export for backwards compatibility with any consumer that imported it
// from this module before the cache was split out.
export { clearCachedRoles };

export function ChannelProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setUserRoles([]);
      setActiveChannel(null);
      setLoading(false);
      return;
    }

    // 1. Hydrate instantly from session cache if present — avoids the
    //    user_roles round-trip on every page navigation/reload.
    const cached = readCachedRoles(user.id);
    if (cached) {
      setUserRoles(cached);
      const available = rolesToChannels(cached);
      setActiveChannel(cached.includes("admin") ? "admin" : available[0]);
      setLoading(false);
    }

    // 2. Skip the DB re-verify when the cache was written recently. This
    //    cuts thousands of repeated user_roles round-trips across portal
    //    navigation within the same browsing session.
    if (cached && isCachedRolesFresh(user.id)) {
      return;
    }

    // 3. Otherwise re-verify against the DB once and refresh cache.
    const fetchRoles = async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const roles = data?.map((r) => r.role) || [];
      writeCachedRoles(user.id, roles);

      setUserRoles((prev) =>
        prev.length === roles.length && prev.every((r, i) => r === roles[i]) ? prev : roles
      );

      if (!cached) {
        const available = rolesToChannels(roles);
        setActiveChannel(roles.includes("admin") ? "admin" : available[0]);
        setLoading(false);
      }
    };

    fetchRoles();
  }, [user]);

  const channels = rolesToChannels(userRoles);
  const isAdmin = userRoles.includes("admin");
  const resolvedChannel = activeChannel || channels[0] || "station";

  if (!user) {
    return (
      <ChannelContext.Provider value={{ channels, activeChannel: resolvedChannel, setActiveChannel: setActiveChannel as (c: Channel) => void, loading: false, userRoles, isAdmin: false }}>
        {children}
      </ChannelContext.Provider>
    );
  }

  if (loading || !activeChannel) {
    return (
      <ChannelContext.Provider value={{ channels, activeChannel: resolvedChannel, setActiveChannel: setActiveChannel as (c: Channel) => void, loading: true, userRoles, isAdmin }}>
        {null}
      </ChannelContext.Provider>
    );
  }

  return (
    <ChannelContext.Provider value={{ channels, activeChannel: resolvedChannel, setActiveChannel: setActiveChannel as (c: Channel) => void, loading, userRoles, isAdmin }}>
      {children}
    </ChannelContext.Provider>
  );
}

export function useChannel() {
  const ctx = useContext(ChannelContext);
  if (!ctx) throw new Error("useChannel must be used within ChannelProvider");
  return ctx;
}
