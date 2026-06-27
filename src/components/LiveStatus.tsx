import { useEffect, useState } from "react";
import { Radio, WifiOff, RefreshCw, Loader2 } from "lucide-react";
import { useRealtimeStatus } from "@/lib/adminRealtime";
import { clsx } from "@/lib/format";

/**
 * Global LIVE indicator for the top bar.
 * Shows connection state, age of last event, reconnecting spinner and a
 * stale-data warning. No manual page refresh required for live data.
 */
export default function LiveStatus() {
  const { status, lastEventAt, reconnectCount } = useRealtimeStatus();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ageMs = lastEventAt ? now - lastEventAt : null;
  const stale = ageMs !== null && ageMs > 30_000 && status === "live";

  const label =
    status === "live"
      ? stale
        ? "Нет событий"
        : "LIVE"
      : status === "connecting"
        ? "Подключение"
        : status === "reconnecting"
          ? "Переподключение"
          : status === "down"
            ? "Нет связи"
            : "—";

  const tone =
    status === "live" && !stale
      ? "live"
      : status === "reconnecting" || status === "connecting"
        ? "warn"
        : "down";

  const ageText =
    ageMs === null
      ? ""
      : ageMs < 2000
        ? "сейчас"
        : ageMs < 60_000
          ? `${Math.floor(ageMs / 1000)}с назад`
          : `${Math.floor(ageMs / 60_000)}м назад`;

  return (
    <div
      data-testid="live-status"
      className={clsx(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold border select-none",
        tone === "live" && "text-sr-success border-sr-success/35 bg-sr-success/10",
        tone === "warn" && "text-sr-warning border-sr-warning/40 bg-sr-warning/10",
        tone === "down" && "text-sr-danger border-sr-danger/35 bg-sr-danger/10",
      )}
      title={
        reconnectCount > 0
          ? `Переподключений: ${reconnectCount}`
          : "Realtime поток администратора"
      }
    >
      {tone === "live" && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-sr-success opacity-70 animate-ping" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-sr-success" />
        </span>
      )}
      {tone === "warn" && <Loader2 className="w-3 h-3 animate-spin" />}
      {tone === "down" && <WifiOff className="w-3 h-3" />}
      <span>{label}</span>
      {status === "live" && !stale && ageText && (
        <span className="text-sr-text-subtle font-normal hidden sm:inline">· {ageText}</span>
      )}
      {stale && <Radio className="w-3 h-3" />}
    </div>
  );
}
