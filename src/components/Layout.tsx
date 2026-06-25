import { NavLink, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  Swords,
  Coins,
  HeartPulse,
  Compass,
  LogOut,
  CircleDot,
  Telescope,
  RefreshCw,
} from "lucide-react";
import { logout, type AdminSession } from "@/services/auth";
import CommandPalette from "@/components/CommandPalette";

const nav = [
  { to: "/overview", label: "Обзор", icon: LayoutDashboard, group: "Наблюдение" },
  { to: "/players", label: "Игроки", icon: Users, group: "Наблюдение" },
  { to: "/matches", label: "Матчи", icon: Swords, group: "Наблюдение" },
  { to: "/insights", label: "Инсайты", icon: Telescope, group: "Аналитика" },
  { to: "/economy", label: "Экономика", icon: Coins, group: "Аналитика" },
  { to: "/health", label: "Система", icon: HeartPulse, group: "Аналитика" },
  { to: "/roadmap", label: "Roadmap", icon: Compass, group: "План" },
];

const groups = ["Наблюдение", "Аналитика", "План"] as const;

export default function Layout({
  children,
  session,
  onLogout,
}: {
  children: React.ReactNode;
  session: AdminSession;
  onLogout: () => void;
}) {
  const loc = useLocation();
  const qc = useQueryClient();
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 shrink-0 border-r border-white/[0.05] bg-ink-900/40 backdrop-blur-xl flex flex-col sticky top-0 h-screen">
        <div className="px-6 py-7">
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9">
              <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-gold-200 to-gold-600" />
              <div className="absolute inset-[6px] rounded-md bg-ink-950" />
              <div className="absolute inset-[12px] rounded-full bg-gradient-to-br from-gold-100 to-gold-400" />
            </div>
            <div className="leading-tight">
              <div className="text-[11px] uppercase tracking-[0.18em] text-ink-400">
                Shashki Royale
              </div>
              <div className="display-title text-lg text-ink-100">Command Center</div>
            </div>
          </div>
        </div>

        <nav className="px-3 flex-1 space-y-6 overflow-y-auto">
          {groups.map((g) => (
            <div key={g}>
              <div className="px-3 mb-2 text-[10px] uppercase tracking-[0.2em] text-ink-500">
                {g}
              </div>
              <div className="space-y-0.5">
                {nav
                  .filter((n) => n.group === g)
                  .map((n) => {
                    const active =
                      loc.pathname === n.to || loc.pathname.startsWith(n.to + "/");
                    return (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        className={() =>
                          [
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all relative",
                            active
                              ? "bg-gold-300/10 text-gold-100"
                              : "text-ink-300 hover:bg-white/[0.03] hover:text-ink-100",
                          ].join(" ")
                        }
                      >
                        {active && (
                          <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-gold-300" />
                        )}
                        <n.icon className="w-4 h-4 shrink-0" />
                        <span className="tracking-tight">{n.label}</span>
                      </NavLink>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-4 pb-5 pt-3 border-t border-white/[0.04] mt-4">
          <div className="text-[10px] uppercase tracking-[0.2em] text-ink-500 mb-2">
            Статус
          </div>
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-ink-300">
              <CircleDot className="w-3 h-3 text-accent-mint animate-pulse" />
              <span>{session.email}</span>
            </div>
            <span className="mono text-ink-500">v1.1</span>
          </div>
          <button
            onClick={() => {
              // 1) Immediately cancel in-flight queries and wipe the
              //    cache so background refetches can't race against
              //    the cookie-clear and surface 401s in the console.
              qc.cancelQueries();
              qc.clear();
              // 2) Flip UI to the login screen synchronously.
              onLogout();
              // 3) Fire-and-forget the server-side cookie clear.
              void logout();
            }}
            data-testid="logout-button"
            className="mt-4 w-full text-xs text-ink-400 hover:text-ink-200 transition-colors flex items-center justify-center gap-2 py-2 rounded-lg border border-white/[0.04] hover:border-white/[0.08]"
          >
            <LogOut className="w-3 h-3" />
            Выйти
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="sticky top-0 z-30 backdrop-blur-xl bg-ink-950/60 border-b border-white/[0.04]">
          <div className="px-10 h-14 max-w-[1400px] mx-auto flex items-center justify-between gap-4">
            <div className="text-xs text-ink-500">
              Production · <span className="text-ink-300">shashki-royale.pages.dev</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  qc.clear();
                  await qc.invalidateQueries();
                }}
                className="px-2.5 py-1.5 rounded-lg border border-white/[0.06] text-[11px] text-ink-300 hover:bg-white/[0.04] hover:text-ink-100 inline-flex items-center gap-1.5 transition-all"
                title="Сбросить кэш и подтянуть свежие данные из Supabase"
                data-testid="force-sync-btn"
              >
                <RefreshCw className="w-3 h-3" /> Sync
              </button>
              <CommandPalette />
            </div>
          </div>
        </div>
        <div className="px-10 py-8 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
