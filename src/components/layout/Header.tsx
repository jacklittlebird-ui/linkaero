import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Settings, LogOut, Moon, Sun, Menu, PanelLeftClose, PanelLeft, Languages } from "lucide-react";
import GlobalSearch from "@/components/GlobalSearch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserStation } from "@/contexts/UserStationContext";
import { useChannel } from "@/contexts/ChannelContext";
import { useTranslation } from "react-i18next";
import { rememberLanguageChoice } from "@/i18n";

interface HeaderProps {
  onMenuClick?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export default function Header({ onMenuClick, sidebarCollapsed, onToggleSidebar }: HeaderProps) {
  const { user, signOut } = useAuth();
  const { station, isStationScoped } = useUserStation();
  const { activeChannel, isAdmin } = useChannel();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    const fetchUnread = async () => {
      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
      setUnreadCount(count ?? 0);
    };
    fetchUnread();
    const channel = supabase
      .channel("header-notifications")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => fetchUnread())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [dark]);

  return (
    <header
      className="h-14 border-b flex items-center px-3 md:px-6 gap-2 md:gap-3 bg-card"
      style={{ borderColor: "hsl(var(--header-border))" }}
    >
      {/* Mobile hamburger */}
      {onMenuClick && (
        <button onClick={onMenuClick} className="p-2 rounded-full hover:bg-muted transition-colors mr-1">
          <Menu size={20} className="text-foreground" />
        </button>
      )}

      {/* Desktop sidebar toggle */}
      {!isMobile && onToggleSidebar && (
        <button onClick={onToggleSidebar} className="p-2 rounded-full hover:bg-muted transition-colors mr-1" title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {sidebarCollapsed ? <PanelLeft size={20} className="text-foreground" /> : <PanelLeftClose size={20} className="text-foreground" />}
        </button>
      )}

      {/* Station scope badge — hidden in operations channel (operations sees all stations) */}
      {isStationScoped && station && activeChannel !== "operations" && (
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs font-bold border border-primary/20 shrink-0"
          title={`Scoped to station ${station}`}
        >
          <span className="opacity-70">Station</span>
          <span>{station}</span>
        </div>
      )}

      {/* Global Search — admin only */}
      <div className="flex-1 min-w-0">
        {isAdmin && <GlobalSearch />}
      </div>

      {/* Language Toggle */}
      <button
        onClick={() => { rememberLanguageChoice(user?.email); i18n.changeLanguage(i18n.language === "ar" ? "en" : "ar"); }}
        className="p-2 rounded-full hover:bg-muted transition-colors shrink-0 flex items-center gap-1"
        title={i18n.language === "ar" ? "Switch to English" : "التبديل إلى العربية"}
      >
        <Languages size={18} className="text-muted-foreground" />
        <span className="text-xs font-semibold">{i18n.language === "ar" ? "EN" : "ع"}</span>
      </button>

      {/* Dark Mode Toggle */}
      <button
        onClick={() => setDark(d => !d)}
        className="p-2 rounded-full hover:bg-muted transition-colors shrink-0"
        title={dark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      >
        {dark ? <Sun size={18} className="text-warning" /> : <Moon size={18} className="text-muted-foreground" />}
      </button>

      {/* Notifications */}
      <button onClick={() => navigate("/notifications")} className="relative p-2 rounded-full hover:bg-muted transition-colors shrink-0">
        <Bell size={18} className="text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent text-[10px] font-bold flex items-center justify-center text-accent-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Settings */}
      {!isMobile && (
        <button onClick={() => navigate("/settings")} className="p-2 rounded-full hover:bg-muted transition-colors">
          <Settings size={18} className="text-muted-foreground" />
        </button>
      )}

      {/* User */}
      {!isMobile && (
        <div className="flex items-center gap-2 ml-1">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">AU</div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-foreground">Admin User</span>
          </div>
        </div>
      )}

      {/* Logout */}
      <button onClick={() => signOut()} className="p-2 rounded-full hover:bg-muted transition-colors shrink-0">
        <LogOut size={18} className="text-muted-foreground" />
      </button>
    </header>
  );
}
