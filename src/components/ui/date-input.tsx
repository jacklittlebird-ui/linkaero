import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const isoToDmy = (iso?: string) => { const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
const dmyToIso = (s: string) => { const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const mask = (raw: string) => { const d = raw.replace(/\D/g, "").slice(0, 8); return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join("/"); };
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseIso = (iso?: string | null) => { const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : undefined; };

/** Calendar button that picks a day; `value`/`onPick` use ISO (YYYY-MM-DD). */
export function CalendarButton({ value, onPick, disabled }: { value?: string | null; onPick: (iso: string) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const selected = parseIso(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} aria-label="فتح النتيجة"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50">
          <CalendarIcon className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={selected} defaultMonth={selected} initialFocus className="p-3 pointer-events-auto"
          onSelect={(d) => { if (d) { onPick(toIso(d)); setOpen(false); } }} />
      </PopoverContent>
    </Popover>
  );
}

type Props = Omit<React.ComponentProps<"input">, "type" | "onChange" | "value"> & {
  value?: string | null;
  onChange?: (e: { target: { value: string; name?: string } }) => void;
};

/** Date field: typed DD/MM/YYYY plus a calendar of days. Emits ISO (YYYY-MM-DD) like a native date input. */
export const DateInput = React.forwardRef<HTMLInputElement, Props>(({ value, onChange, className, disabled, name, ...rest }, ref) => {
  const [text, setText] = React.useState(isoToDmy(value ?? ""));
  React.useEffect(() => { setText(isoToDmy(value ?? "")); }, [value]);
  const emit = (iso: string) => onChange?.({ target: { value: iso, name } });
  return (
    <div className={cn("flex w-full items-center gap-1", className)}>
      <input ref={ref} name={name} disabled={disabled} inputMode="numeric" maxLength={10} {...rest}
        value={text}
        onChange={(e) => {
          const t = mask(e.target.value); setText(t);
          if (t === "") emit(""); else { const iso = dmyToIso(t); if (iso) emit(iso); }
        }}
        className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm" />
      <CalendarButton value={value} disabled={disabled} onPick={emit} />
    </div>
  );
});
DateInput.displayName = "DateInput";
