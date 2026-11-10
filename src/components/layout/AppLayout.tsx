import { useState } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen w-full">
      {isMobile ? (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side={document.documentElement.dir === "rtl" ? "right" : "left"} className="p-0 w-64">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </SheetContent>
        </Sheet>
      ) : (
        <Sidebar collapsed={sidebarCollapsed} />
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onMenuClick={isMobile ? () => setSidebarOpen(true) : undefined}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={!isMobile ? () => setSidebarCollapsed(c => !c) : undefined}
        />
        <main className="flex-1 min-w-0 p-3 md:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
