import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useChannel, CHANNEL_LABELS, CHANNEL_DESCRIPTIONS, type Channel } from "@/contexts/ChannelContext";
import { 
  ShieldCheck, Building2, FileText, Eye, Receipt, CreditCard, Shield, Calculator, Landmark
} from "lucide-react";

const CHANNEL_ICONS: Record<Channel, React.ReactNode> = {
  treasury: <Landmark size={16} />,
  clearance: <ShieldCheck size={14} />,
  station: <Building2 size={14} />,
  contracts: <FileText size={14} />,
  operations: <Eye size={14} />,
  receivables: <Receipt size={14} />,
  payables: <CreditCard size={14} />,
  general_accounts: <Calculator size={14} />,
  admin: <Shield size={14} />,
};

export function ChannelSwitcher() {
  const { channels, activeChannel, setActiveChannel } = useChannel();
  const activeLabel = CHANNEL_LABELS[activeChannel];
  const activeDescription = CHANNEL_DESCRIPTIONS[activeChannel];

  if (channels.length <= 1) {
    return (
      <div className="mx-3 mb-3 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/70 px-3 py-2.5 text-sidebar-accent-foreground shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0">{CHANNEL_ICONS[activeChannel]}</span>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold uppercase tracking-[0.18em]">{activeLabel}</div>
            <div className="truncate text-[10px] normal-case tracking-normal text-sidebar-foreground/70">{activeDescription}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-3">
      <Select value={activeChannel} onValueChange={(v) => setActiveChannel(v as Channel)}>
        <SelectTrigger className="h-auto min-h-11 rounded-lg border-sidebar-border/60 bg-sidebar-accent/70 px-3 py-2 text-sidebar-accent-foreground shadow-sm hover:bg-sidebar-accent focus:ring-sidebar-ring">
          <div className="flex min-w-0 items-center gap-2 text-left">
            <span className="shrink-0">{CHANNEL_ICONS[activeChannel]}</span>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold uppercase tracking-[0.18em]">{activeLabel}</div>
              <div className="truncate text-[10px] normal-case tracking-normal text-sidebar-foreground/70">{activeDescription}</div>
            </div>
          </div>
        </SelectTrigger>
        <SelectContent>
          {channels.map(ch => (
            <SelectItem key={ch} value={ch}>
              <div className="flex items-center gap-2">
                {CHANNEL_ICONS[ch]}
                <div>
                  <div className="font-semibold text-xs">{CHANNEL_LABELS[ch]}</div>
                  <div className="text-[10px] text-muted-foreground">{CHANNEL_DESCRIPTIONS[ch]}</div>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
