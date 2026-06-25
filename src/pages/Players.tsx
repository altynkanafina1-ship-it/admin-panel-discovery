import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Search, Users, Download, Filter, X } from "lucide-react";
import { fetchPlayers, type PlayersQuery } from "@/services/admin";
import { fmtNum, fmtRelative, clsx } from "@/lib/format";
import { Empty, PageHeader, Section, Skeleton } from "@/components/ui";
import { Avatar } from "@/pages/Overview";
import { useRealtimeTable } from "@/lib/realtime";
import type { PublicProfile } from "@/lib/types";

const SORT_OPTIONS = [
  { key: "last_seen_at", label: "Последний визит" },
  { key: "created_at", label: "Регистрация" },
  { key: "rating", label: "Рейтинг" },
  { key: "total_games", label: "Игр" },
  { key: "best_win_streak", label: "Стрик" },
] as const;

const PAGE_SIZE = 50;

export default function Players() {
  const [params, setParams] = useSearchParams();
  const sort = (params.get("sort") as PlayersQuery["sort"]) || "last_seen_at";
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<{
    hasGames: boolean;
    active24h: boolean;
    minStreak: number;
  }>({ hasGames: false, active24h: false, minStreak: 0 });

  const query: PlayersQuery = {
    sort,
    dir: "desc",
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    search: search || undefined,
    hasGames: filters.hasGames || undefined,
    active24h: filters.active24h || undefined,
    minStreak: filters.minStreak > 0 ? filters.minStreak : undefined,
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["players", query],
    queryFn: () => fetchPlayers(query),
    placeholderData: (prev) => prev,
    refetchInterval: 20_000,
  });

  const qc = useQueryClient();
  useRealtimeTable("public_profiles", () =>
    qc.invalidateQueries({ queryKey: ["players"] }),
  );

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const winrate = useMemo(
    () => (p: PublicProfile) =>
      p.total_games > 0 ? Math.round((p.wins / p.total_games) * 100) : 0,
    [],
  );

  function clearFilters() {
    setFilters({ hasGames: false, active24h: false, minStreak: 0 });
    setSearch("");
    setPage(0);
  }

  // CSV formula injection guard (FIND-018) — prefix any cell starting with
  // a spreadsheet-formula character with a single quote so Excel/LibreOffice
  // treat it as literal text.
  function csvCell(v: string | number | null | undefined): string {
    const raw = String(v ?? "");
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    // Always wrap in double quotes and escape embedded quotes.
    return `"${safe.replace(/"/g, '""')}"`;
  }
  function exportCsv() {
    const header = [
      "id",
      "nickname",
      "rating",
      "total_games",
      "wins",
      "losses",
      "draws",
      "win_streak",
      "best_win_streak",
      "created_at",
      "last_seen_at",
    ];
    const lines = rows.map((p) =>
      [
        csvCell(p.id),
        csvCell(p.nickname),
        csvCell(p.rating),
        csvCell(p.total_games),
        csvCell(p.wins),
        csvCell(p.losses),
        csvCell(p.draws),
        csvCell(p.win_streak),
        csvCell(p.best_win_streak),
        csvCell(p.created_at),
        csvCell(p.last_seen_at),
      ].join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shashki-players-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasActiveFilters = filters.hasGames || filters.active24h || filters.minStreak > 0 || !!search;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span>
            Live · <span className="mono text-ink-300">public_profiles</span> · {fmtNum(total)} всего
          </span>
        }
        title="Игроки"
        description="Все профили с рейтингом, статистикой и стриками. Поиск, фильтры, пагинация, CSV."
        actions={
          <button onClick={exportCsv} className="btn-ghost" data-testid="export-csv-btn">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        }
      />

      <Section
        title="Реестр игроков"
        description={`Страница ${page + 1} из ${Math.max(1, Math.ceil(total / PAGE_SIZE))} · ${rows.length} строк`}
        right={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="никнейм…"
                className="w-56 pl-9 pr-3 py-2 rounded-lg bg-ink-800/70 border border-white/[0.05] focus:border-gold-300/40 focus:outline-none text-sm text-ink-100 placeholder:text-ink-500"
                data-testid="players-search-input"
              />
            </div>
            <div className="flex items-center gap-1 panel-soft p-1">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("sort", o.key);
                    setParams(next);
                    setPage(0);
                  }}
                  className={clsx(
                    "px-2.5 py-1.5 rounded-md text-[11px] tracking-tight transition-colors",
                    sort === o.key
                      ? "bg-gold-300/15 text-gold-200"
                      : "text-ink-400 hover:text-ink-200",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="text-[11px] uppercase tracking-[0.16em] text-ink-500 mr-1 inline-flex items-center gap-1">
            <Filter className="w-3 h-3" /> фильтры
          </span>
          <ChipToggle
            active={filters.hasGames}
            onClick={() => {
              setFilters((f) => ({ ...f, hasGames: !f.hasGames }));
              setPage(0);
            }}
          >
            играли хотя бы раз
          </ChipToggle>
          <ChipToggle
            active={filters.active24h}
            onClick={() => {
              setFilters((f) => ({ ...f, active24h: !f.active24h }));
              setPage(0);
            }}
          >
            активны 24ч
          </ChipToggle>
          <ChipToggle
            active={filters.minStreak >= 5}
            onClick={() => {
              setFilters((f) => ({ ...f, minStreak: f.minStreak >= 5 ? 0 : 5 }));
              setPage(0);
            }}
          >
            стрик ≥ 5
          </ChipToggle>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-[11px] text-ink-400 hover:text-ink-100 inline-flex items-center gap-1"
            >
              <X className="w-3 h-3" /> сбросить
            </button>
          )}
          {isFetching && (
            <span className="ml-auto text-[11px] text-ink-500 mono">обновляю…</span>
          )}
        </div>

        {isLoading ? (
          <Skeleton rows={10} />
        ) : rows.length === 0 ? (
          <Empty message="Ничего не найдено" icon={<Users className="w-8 h-8" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="players-table">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.16em] text-ink-500 border-b border-white/[0.05]">
                  <th className="text-left font-medium py-3 pl-3">Игрок</th>
                  <th className="text-right font-medium py-3">Рейтинг</th>
                  <th className="text-right font-medium py-3">Игры</th>
                  <th className="text-right font-medium py-3">W/L/D</th>
                  <th className="text-right font-medium py-3">Win rate</th>
                  <th className="text-right font-medium py-3">Стрик</th>
                  <th className="text-right font-medium py-3 pr-3">Видели</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const wr = winrate(p);
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-white/[0.025] row-hover"
                    >
                      <td className="py-3 pl-3">
                        <Link to={`/players/${p.id}`} className="flex items-center gap-3 group">
                          <Avatar idx={p.avatar_index} name={p.nickname} />
                          <div className="min-w-0">
                            <div className="text-ink-100 group-hover:text-gold-200 transition-colors truncate max-w-[220px]">
                              {p.nickname}
                            </div>
                            <div className="text-[11px] text-ink-500 mono">{p.id.slice(0, 8)}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="text-right mono text-gold-200">{fmtNum(p.rating)}</td>
                      <td className="text-right text-ink-300 mono">{fmtNum(p.total_games)}</td>
                      <td className="text-right text-[12px] mono">
                        <span className="text-accent-mint">{p.wins}</span>
                        <span className="text-ink-500">/</span>
                        <span className="text-accent-rose">{p.losses}</span>
                        <span className="text-ink-500">/</span>
                        <span className="text-ink-300">{p.draws}</span>
                      </td>
                      <td className="text-right">
                        <span
                          className={clsx(
                            "mono text-sm",
                            wr >= 60
                              ? "text-accent-mint"
                              : wr >= 40
                                ? "text-ink-200"
                                : "text-accent-rose/80",
                          )}
                        >
                          {p.total_games > 0 ? `${wr}%` : "—"}
                        </span>
                      </td>
                      <td className="text-right">
                        {p.best_win_streak > 0 ? (
                          <span className="chip-gold">★ {p.best_win_streak}</span>
                        ) : (
                          <span className="text-ink-500 text-xs">—</span>
                        )}
                      </td>
                      <td className="text-right pr-3 text-ink-400 text-xs">
                        {fmtRelative(p.last_seen_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="mt-5 flex items-center justify-between gap-3 text-[12px]">
          <div className="text-ink-500">
            {fmtNum(page * PAGE_SIZE + 1)}–{fmtNum(Math.min((page + 1) * PAGE_SIZE, total))} из {fmtNum(total)}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg border border-white/[0.05] text-ink-300 hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              ← Назад
            </button>
            <span className="mono text-ink-400">
              {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * PAGE_SIZE >= total}
              className="px-3 py-1.5 rounded-lg border border-white/[0.05] text-ink-300 hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Вперёд →
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}

function ChipToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-2.5 py-1 rounded-full text-[11px] tracking-tight border transition-all",
        active
          ? "bg-gold-300/10 border-gold-300/40 text-gold-200"
          : "bg-white/[0.02] border-white/[0.06] text-ink-400 hover:text-ink-100",
      )}
    >
      {children}
    </button>
  );
}
