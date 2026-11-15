import { useLocation, Link } from "react-router-dom";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { useChannel } from "@/contexts/ChannelContext";
import { getNavForChannel, type NavChild } from "@/config/channelNavConfig";
import { ChannelSwitcher } from "./ChannelSwitcher";
import oneOpsLogo from "@/assets/one-ops-logo.png";
import linkAeroLogo from "@/assets/linkaero-logo.png";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface SidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
}

export default function Sidebar({ onNavigate, collapsed = false }: SidebarProps) {
  const location = useLocation();
  const currentPath = location.pathname;
  const { activeChannel } = useChannel();
  const { t } = useTranslation();
  const tSection = (label: string) => t(`nav.sections.${label}`, label);
  const tItem = (label: string) => t(`nav.items.${label}`, label);

  const navSections = getNavForChannel(activeChannel);

  const isChildActive = (children: NavChild[]) =>
    children.some(c => currentPath === c.path);

  const defaultExpanded: Record<string, boolean> = {};
  navSections.forEach(s => {
    if (s.collapsible && s.children) {
      defaultExpanded[s.label] = true;
    }
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>(defaultExpanded);
  const toggle = (label: string) => setExpanded(prev => ({ ...prev, [label]: !prev[label] }));

  const isActive = (path: string) => currentPath === path;

  return (
    <TooltipProvider delayDuration={0}>
      <aside className={`${collapsed ? "w-14" : "w-56"} h-screen bg-sidebar flex flex-col shrink-0 transition-all duration-200 overflow-hidden`}>
        {/* Logo */}
        <div className="px-2 pt-3 pb-2">
          {collapsed ? (
            <div className="flex items-center justify-center rounded-lg bg-white dark:bg-muted p-1.5">
              <img src={oneOpsLogo} alt="One OPS" className="h-7 shrink-0 object-contain" />
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1 rounded-lg bg-white dark:bg-muted px-3 py-2.5">
              <img src={linkAeroLogo} alt="Link Aero" className="h-7 shrink-0 object-contain" />
              <div className="h-6 w-px bg-border" />
              <img src={oneOpsLogo} alt="One OPS" className="h-8 shrink-0 object-contain" />
            </div>
          )}
        </div>

        {!collapsed && <ChannelSwitcher />}

        <nav className="flex-1 px-1.5 py-2 space-y-0.5 overflow-y-auto text-base">
          {navSections.map((section) => (
            <div key={section.label}>
              {section.collapsible ? (
                <>
                  {collapsed ? (
                    // Collapsed: show only icon with tooltip
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center px-1 py-2 rounded text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-default">
                          {section.icon}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="flex flex-col gap-1 p-2">
                        <span className="font-semibold text-xs mb-1">{tSection(section.label)}</span>
                        {section.children?.map((child) => (
                          <Link
                            key={child.label}
                            to={child.path}
                            onClick={onNavigate}
                            className={`text-xs px-2 py-1 rounded transition-colors ${
                              isActive(child.path) ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-muted"
                            }`}
                          >
                            {tItem(child.label)}
                          </Link>
                        ))}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <>
                      <button
                        onClick={() => toggle(section.label)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sidebar-foreground hover:bg-sidebar-accent transition-colors ${
                          section.children && isChildActive(section.children) ? "bg-sidebar-accent/60" : ""
                        }`}
                      >
                        {section.icon}
                        <span className="flex-1 text-left font-medium text-sm uppercase tracking-wider">
                          {tSection(section.label)}
                        </span>
                        {expanded[section.label] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      {expanded[section.label] && section.children && (
                        <div className="ml-4 space-y-0.5">
                          {section.children.map((child) => (
                            <Link
                              key={child.label}
                              to={child.path}
                              onClick={onNavigate}
                              className={`block px-3 py-1.5 rounded text-base transition-colors ${
                                isActive(child.path)
                                  ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                                  : "text-sidebar-foreground hover:bg-sidebar-accent"
                              }`}
                            >
                              {tItem(child.label)}
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      to={section.path || "/"}
                      onClick={onNavigate}
                      className={`flex items-center justify-center px-1 py-2 rounded transition-colors ${
                        isActive(section.path || "/")
                          ? "bg-sidebar-primary text-sidebar-primary-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent"
                      }`}
                    >
                      {section.icon}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{tSection(section.label)}</TooltipContent>
                </Tooltip>
              ) : (
                <Link
                  to={section.path || "/"}
                  onClick={onNavigate}
                  className={`flex items-center gap-2 px-3 py-2 rounded transition-colors ${
                    isActive(section.path || "/")
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                      : "text-sidebar-foreground hover:bg-sidebar-accent"
                  }`}
                >
                  {section.icon}
                  <span className="text-sm uppercase tracking-wider font-medium">{tSection(section.label)}</span>
                </Link>
              )}
            </div>
          ))}
        </nav>
      </aside>
    </TooltipProvider>
  );
}
