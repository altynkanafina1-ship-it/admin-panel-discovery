import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  Users,
  Swords,
  Coins,
  Activity,
  Crown,
  Sparkles,
  TrendingUp,
  ArrowUpRight,
  Wifi,
  CircleDot,
  Radio,
} from "lucide-react";
import {
  fetchActiveUsers,
  fetchActivityHeatmap,
  fetchFunnel,
  fetchGames,
  fetchGamesTrend,
  fetchPlayers,
  fetchSignupTrend,
  fetchStakes,
  fetchTotals,
} from "@/services/admin";
import { fmtCoin, fmtNum, fmtRelative, clsx } from "@/lib/format";
import { Kpi, PageHeader, Section, Skeleton, Empty } from "@/components/ui";
import { Link } from "react-router-dom";
import { GAME_URL } from "@/lib/supabase";
import { useRealtimeEvent } from "@/lib/adminRealtime";
import CountUp from "@/components/CountUp";
import LiveFeed from "@/components/LiveFeed";
import { useToast } from "@/components/Toast";
import { fetchWalletsSummary } from "@/services/auth";

export default function Overview() {
  const qc = useQueryClient();
  const toast = useToast();
  const knownPlayers = useRef<number | null>(null);
  const knownActiveGames = useRef<number | null>(null);

  // Secure realtime: events arrive from the Cloudflare authn gateway (service-role
  // server-side). We do TARGETED, scoped invalidation per event type — never a
  // blanket invalidateQueries (FIND V2-003 / V2-UX-3 / SLO: no full-table refetch).
  useRealtimeEvent((e) => {
    switch (e.entity_type) {
      case "game":
        qc.invalidateQueries({ queryKey: ["games", "active"] });
        if (e.event_type === "game.ended")
          qc.invalidateQueries({ queryKey: ["games", "recent"] });
        qc.invalidateQueries({ queryKey: ["totals"] });
        qc.invalidateQueries({ queryKey: ["activity-feed"] });
        break;
      case "player":
        qc.invalidateQueries({ queryKey: ["active-users"] });
        qc.invalidateQueries({ queryKey: ["totals"] });
        break;
      case "stake":
      case "wallet":
        qc.invalidateQueries({ queryKey: ["stakes", "recent"] });
        qc.invalidateQueries({ queryKey: ["wallets-summary"] });
        break;
    }
  });

  const totals = useQuery({ queryKey: ["totals"], queryFn: fetchTotals, refetchInterval: 15_000 });
  const activeUsers = useQuery({
    queryKey: ["active-users"],
    queryFn: fetchActiveUsers,
    refetchInterval: 15_000,
  });
  const funnel = useQuery({ queryKey: ["funnel"], queryFn: fetchFunnel, refetchInterval: 60_000 });
  const heatmap = useQuery({
    queryKey: ["heatmap"],
    queryFn: () => fetchActivityHeatmap(14),
    refetchInterval: 60_000,
  });
  const signup = useQuery({ queryKey: ["signup-trend"], queryFn: () => fetchSignupTrend(14), refetchInterval: 60_000 });
  const games = useQuery({ queryKey: ["games-trend"], queryFn: () => fetchGamesTrend(14), refetchInterval: 60_000 });
  const top = useQuery({
    queryKey: ["players", "top"],
    queryFn: () => fetchPlayers({ sort: "rating", dir: "desc", limit: 6 }),
    refetchInterval: 60_000,
  });
  const live = useQuery({
    queryKey: ["games", "active"],
    queryFn: () => fetchGames({ status: "playing", limit: 8 }),
    refetchInterval: 15_000,
  });
  const recent = useQuery({
    queryKey: ["games", "recent"],
    queryFn: () => fetchGames({ status: "finished", limit: 6 }),
    refetchInterval: 30_000,
  });
  const stakes = useQuery({
    queryKey: ["stakes", "recent"],
    queryFn: () => fetchStakes({ limit: 200 }),
    refetchInterval: 60_000,
  });

  // Toast: notify when total players grows
  useEffect(() => {
    const c = totals.data?.players;
    if (c === undefined) return;
    if (knownPlayers.current !== null && c > knownPlayers.current) {
      const delta = c - knownPlayers.current;
      toast.push({
        kind: "new-player",
        title: delta === 1 ? "Новый игрок зарегистрирован" : `+${delta} новых игроков`,
        description: `Всего теперь ${fmtNum(c)}`,
        href: "/players",
      });
    }
    knownPlayers.current = c;
  }, [totals.data?.players, toast]);

  // Toast: notify when a new game appears (active count grows)
  useEffect(() => {
    const c = totals.data?.active;
    if (c === undefined) return;
    if (knownActiveGames.current !== null && c > knownActiveGames.current) {
      toast.push({
        kind: "new-game",
        title: "Началась новая партия",
        description: `Активных сейчас: ${fmtNum(c)}`,
        href: "/matches",
      });
    }
    knownActiveGames.current = c;
  }, [totals.data?.active, toast]);

  const t = totals.data;
  const totalPot = (stakes.data ?? []).reduce((s, x) => s + Number(x.pot_amount || 0), 0);
  const paidPot = (stakes.data ?? [])
    .filter((x) => x.payout_status === "paid")
    .reduce((s, x) => s + Number(x.pot_amount || 0), 0);
  const commission = Math.round(paidPot * 0.05);
  const liveCount = live.data?.length ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <span className={clsx("relative flex h-2 w-2")}>
              <span className="absolute inset-0 rounded-full bg-accent-mint opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-mint" />
            </span>
            Live · Production · Realtime
          </span>
        }
        title="Командный центр"
        description="Каждый виджет — живая Supabase-таблица. Подписки realtime обновляют активные партии за секунду. Никаких моков."
        actions={
          <a
            href={GAME_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
            data-testid="open-game-btn"
          >
            Открыть игру <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi
          icon={<Users className="w-4 h-4" />}
          label="Игроки"
          value={<CountUp value={t?.players} />}
          hint={
            <span>
              <CountUp value={t?.playedAtLeastOnce} className="text-accent-mint" />{" "}
              сыграли хотя бы 1 партию
            </span>
          }
          tone="gold"
        />
        <Kpi
          icon={<Wifi className="w-4 h-4" />}
          label="Активность"
          value={<CountUp value={activeUsers.data?.d1} />}
          hint={
            <span>
              <span className="text-accent-mint">DAU</span> ·{" "}
              <CountUp value={activeUsers.data?.d7} /> <span className="text-ink-500">WAU</span> ·{" "}
              <CountUp value={activeUsers.data?.d30} /> <span className="text-ink-500">MAU</span>
            </span>
          }
          tone="mint"
        />
        <Kpi
          icon={<Swords className="w-4 h-4" />}
          label="Партии всего"
          value={<CountUp value={t?.games} />}
          hint={
            <span>
              <span className={liveCount > 0 ? "text-accent-mint" : "text-ink-400"}>
                <CountUp value={liveCount} />
              </span>{" "}
              сейчас · <CountUp value={t?.finished} /> завершено
            </span>
          }
        />
        <Kpi
          icon={<Coins className="w-4 h-4" />}
          label="Coin в обороте"
          value={<CountUp value={totalPot} format={fmtCoin} />}
          hint={
            <span>
              комиссия ≈{" "}
              <CountUp value={commission} format={fmtCoin} className="text-gold-300 mono" /> по{" "}
              <CountUp value={t?.stakes} /> ставочным играм
            </span>
          }
          tone="gold"
        />
      </div>

      {/* Coin supply (via /api with service_role) */}
      <CoinSupply />

      {/* Funnel */}
      <Funnel funnel={funnel.data} loading={funnel.isLoading} />

      {/* Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section
          title="Регистрации"
          description="Новые игроки за 14 дней"
          right={
            <div className="chip-gold">
              <Sparkles className="w-3 h-3" /> trend
            </div>
          }
        >
          <div className="h-56">
            {signup.isLoading ? (
              <Skeleton rows={5} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={signup.data ?? []}>
                  <defs>
                    <linearGradient id="gSignup" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#C39A48" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#C39A48" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(v) => v.slice(5)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis axisLine={false} tickLine={false} width={28} />
                  <Tooltip
                    contentStyle={{
                      background: "#FFFDF8",
                      border: "1px solid #D9C9B7",
                      borderRadius: 10,
                      fontSize: 12,
                      color: "#2B241E",
                    }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#C39A48" strokeWidth={2} fill="url(#gSignup)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Section>

        <Section
          title="Завершённые матчи"
          description="За последние 14 дней"
          right={
            <div className="chip-mint">
              <TrendingUp className="w-3 h-3" /> activity
            </div>
          }
        >
          <div className="h-56">
            {games.isLoading ? (
              <Skeleton rows={5} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={games.data ?? []}>
                  <defs>
                    <linearGradient id="gGames" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#56815D" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#56815D" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(v) => v.slice(5)} axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} width={28} />
                  <Tooltip
                    contentStyle={{
                      background: "#FFFDF8",
                      border: "1px solid #D9C9B7",
                      borderRadius: 10,
                      fontSize: 12,
                      color: "#2B241E",
                    }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#56815D" strokeWidth={2} fill="url(#gGames)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Section>
      </div>

      {/* Activity heatmap + Live feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Section
            title="Когда играют"
            description="Тепловая карта ходов по дням и часам (14 дней, UTC)"
            right={
              <span className="chip-gold">
                <Activity className="w-3 h-3" /> heatmap
              </span>
            }
          >
            {heatmap.isLoading ? (
              <Skeleton rows={7} />
            ) : (
              <Heatmap data={heatmap.data ?? []} />
            )}
          </Section>
        </div>

        <Section
          title="Лента событий"
          description="Регистрации, ходы и финалы"
          right={
            <span className="chip-mint">
              <Radio className="w-3 h-3 animate-pulse" /> live
            </span>
          }
        >
          <LiveFeed />
        </Section>
      </div>

      {/* 3-col bottom */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section
          title="Топ рейтинга"
          description="Шесть сильнейших"
          right={
            <Link to="/players?sort=rating" className="text-xs text-gold-300 hover:underline">
              Все →
            </Link>
          }
        >
          {top.isLoading ? (
            <Skeleton />
          ) : (top.data?.rows ?? []).length === 0 ? (
            <Empty message="Нет данных" icon={<Users className="w-8 h-8" />} />
          ) : (
            <ol className="space-y-1.5">
              {(top.data?.rows ?? []).map((p, i) => (
                <li key={p.id}>
                  <Link
                    to={`/players/${p.id}`}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg row-hover"
                  >
                    <span
                      className={clsx(
                        "w-6 text-center mono text-xs",
                        i === 0
                          ? "text-gold-200"
                          : i === 1
                            ? "text-ink-100"
                            : i === 2
                              ? "text-gold-400"
                              : "text-ink-500",
                      )}
                    >
                      {i + 1}
                    </span>
                    <Avatar idx={p.avatar_index} name={p.nickname} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink-100 truncate">{p.nickname}</div>
                      <div className="text-[11px] text-ink-500">
                        {fmtNum(p.total_games)} партий · стрик {p.best_win_streak ?? 0}
                      </div>
                    </div>
                    <div className="mono text-sm text-gold-200">{fmtNum(p.rating)}</div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section
          title="Сейчас играют"
          description={liveCount > 0 ? `${liveCount} активных комнат` : "Активные комнаты"}
          right={
            <span className={liveCount > 0 ? "chip-mint" : "chip-mute"}>
              <CircleDot className={clsx("w-3 h-3", liveCount > 0 && "animate-pulse")} />
              {liveCount > 0 ? "live" : "тихо"}
            </span>
          }
        >
          {live.isLoading ? (
            <Skeleton />
          ) : (live.data ?? []).length === 0 ? (
            <Empty
              message="Никто не играет прямо сейчас. Когда кто-то начнёт — здесь загорится за секунду."
              icon={<Swords className="w-8 h-8" />}
            />
          ) : (
            <ul className="space-y-1.5">
              {(live.data ?? []).map((g) => (
                <li key={g.id}>
                  <Link
                    to={`/matches/${g.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg row-hover"
                  >
                    <div className="min-w-0">
                      <div className="mono text-xs text-ink-300">{g.room_code}</div>
                      <div className="text-[11px] text-ink-500">
                        ход #{g.move_number} · {fmtRelative(g.last_move_at ?? g.updated_at)}
                      </div>
                    </div>
                    <span
                      className={clsx(
                        "w-2 h-2 rounded-full",
                        g.current_turn === "white" ? "bg-gold-100" : "bg-ink-300",
                      )}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Свежие итоги"
          description="Последние партии"
          right={
            <Link to="/matches" className="text-xs text-gold-300 hover:underline">
              Все →
            </Link>
          }
        >
          {recent.isLoading ? (
            <Skeleton />
          ) : (recent.data ?? []).length === 0 ? (
            <Empty message="Нет завершённых матчей" />
          ) : (
            <ul className="space-y-1.5">
              {(recent.data ?? []).map((g) => (
                <li key={g.id}>
                  <Link
                    to={`/matches/${g.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg row-hover"
                  >
                    <div className="min-w-0">
                      <div className="mono text-xs text-ink-300 flex items-center gap-2">
                        {g.room_code}
                        {g.winner === "white" && <Crown className="w-3 h-3 text-gold-300" />}
                      </div>
                      <div className="text-[11px] text-ink-500 truncate">
                        {g.resign_reason ?? "—"} · {fmtRelative(g.updated_at)}
                      </div>
                    </div>
                    <span
                      className={clsx(
                        "chip",
                        g.winner === "white"
                          ? "bg-gold-300/10 border-gold-300/30 text-gold-200"
                          : g.winner === "black"
                            ? "bg-ink-300/10 border-ink-300/20 text-ink-200"
                            : "bg-white/[0.03] border-white/10 text-ink-400",
                      )}
                    >
                      {g.winner === "white" ? "белые" : g.winner === "black" ? "чёрные" : "ничья"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function CoinSupply() {
  const { data, isLoading } = useQuery({
    queryKey: ["wallets-summary"],
    queryFn: fetchWalletsSummary,
    refetchInterval: 30_000,
    retry: false,
  });
  if (isLoading || !data) return null;
  const t = data.totals;
  return (
    <div className="panel p-6 relative overflow-hidden">
      <div className="absolute -right-12 -top-12 w-72 h-72 rounded-full bg-gradient-to-br from-gold-400/15 to-transparent blur-3xl pointer-events-none" />
      <div className="relative flex flex-wrap items-end gap-6 justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-gold-300/80 mb-1">
            Coin в системе · live через /api
          </div>
          <div className="display-title text-4xl text-gold-200">
            <CountUp value={t.balance} format={fmtCoin} /> <span className="text-ink-400 text-lg">Coin</span>
          </div>
          <div className="text-xs text-ink-400 mt-1">
            на {fmtNum(data.walletCount)} кошельках · в locked{" "}
            <span className="text-accent-sky mono">
              <CountUp value={t.locked} format={fmtCoin} />
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="panel-soft p-3 min-w-[120px]">
            <div className="text-[10px] uppercase tracking-[0.16em] text-ink-500">Выиграно всего</div>
            <div className="mt-1 text-xl text-accent-mint mono">
              <CountUp value={t.won} format={fmtCoin} />
            </div>
          </div>
          <div className="panel-soft p-3 min-w-[120px]">
            <div className="text-[10px] uppercase tracking-[0.16em] text-ink-500">Проиграно всего</div>
            <div className="mt-1 text-xl text-accent-rose/90 mono">
              <CountUp value={t.lost} format={fmtCoin} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function Funnel({
  funnel,
  loading,
}: {
  funnel:
    | { registered: number; played1: number; played5: number; stake1: number }
    | undefined;
  loading: boolean;
}) {
  const steps = [
    { label: "Зарегистрировано", value: funnel?.registered ?? 0, tone: "ink" as const },
    { label: "Сыграло ≥ 1 партии", value: funnel?.played1 ?? 0, tone: "gold" as const },
    { label: "Сыграло ≥ 5 партий", value: funnel?.played5 ?? 0, tone: "mint" as const },
    { label: "Сыграло ставочную", value: funnel?.stake1 ?? 0, tone: "rose" as const },
  ];
  const max = Math.max(1, steps[0].value);
  return (
    <Section
      title="Воронка вовлечения"
      description="От регистрации до первой ставки — как игроки погружаются"
      right={
        <div className="chip-gold">
          <Activity className="w-3 h-3" /> live
        </div>
      }
    >
      {loading ? (
        <Skeleton rows={4} />
      ) : (
        <div className="space-y-2.5">
          {steps.map((s, i) => {
            const pct = (s.value / max) * 100;
            const conv = i === 0 ? 100 : (s.value / Math.max(1, steps[0].value)) * 100;
            return (
              <div key={s.label} className="grid grid-cols-[180px_1fr_auto] items-center gap-4">
                <div className="text-sm text-ink-300">{s.label}</div>
                <div className="relative h-7 rounded-md bg-ink-800/70 overflow-hidden">
                  <div
                    className={clsx(
                      "absolute inset-y-0 left-0 transition-all rounded-md",
                      s.tone === "ink" && "bg-gradient-to-r from-ink-600 to-ink-500",
                      s.tone === "gold" && "bg-gradient-to-r from-gold-600 to-gold-300",
                      s.tone === "mint" && "bg-gradient-to-r from-accent-mint/40 to-accent-mint",
                      s.tone === "rose" && "bg-gradient-to-r from-accent-rose/30 to-accent-rose",
                    )}
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                  <div className="absolute inset-y-0 left-3 flex items-center text-[12px] mono text-ink-50/95">
                    {fmtNum(s.value)}
                  </div>
                </div>
                <div className="text-[11px] mono text-ink-400 w-14 text-right">
                  {conv.toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function Heatmap({ data }: { data: number[][] }) {
  const max = Math.max(1, ...data.flat());
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[24px_repeat(24,minmax(0,1fr))] gap-[2px] text-[9px] text-ink-500 mono">
        <div />
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} className="text-center">
            {i % 3 === 0 ? i : ""}
          </div>
        ))}
      </div>
      {data.map((row, r) => (
        <div
          key={r}
          className="grid grid-cols-[24px_repeat(24,minmax(0,1fr))] gap-[2px]"
        >
          <div className="text-[10px] text-ink-500 mono pr-1 text-right">{days[r]}</div>
          {row.map((v, c) => {
            const intensity = v === 0 ? 0 : v / max;
            const bg = v === 0
              ? "rgba(43,36,30,0.05)"
              : `rgba(195,154,72,${0.15 + intensity * 0.85})`;
            return (
              <div
                key={c}
                className="h-5 rounded-[3px] cursor-default"
                style={{ background: bg }}
                title={`${days[r]} ${c}:00 — ${v} ход(ов)`}
              />
            );
          })}
        </div>
      ))}
      <div className="flex items-center justify-end gap-1.5 pt-2 text-[10px] text-ink-500">
        <span>меньше</span>
        {[0.1, 0.25, 0.5, 0.75, 1].map((a, i) => (
          <span
            key={i}
            className="w-3 h-3 rounded-[2px]"
            style={{ background: `rgba(195,154,72,${0.15 + a * 0.85})` }}
          />
        ))}
        <span>больше</span>
      </div>
    </div>
  );
}

export function Avatar({ idx, name }: { idx: number; name: string }) {
  const palette = [
    "from-gold-300 to-gold-600",
    "from-accent-mint to-emerald-700",
    "from-accent-sky to-blue-800",
    "from-accent-rose to-rose-800",
    "from-purple-400 to-purple-800",
    "from-orange-400 to-orange-800",
    "from-teal-400 to-teal-800",
    "from-pink-400 to-pink-800",
  ];
  const cls = palette[((idx ?? 0) + 8) % palette.length];
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <div
      className={`w-8 h-8 rounded-full bg-gradient-to-br ${cls} flex items-center justify-center text-[12px] font-semibold text-ink-950 shrink-0`}
    >
      {initial}
    </div>
  );
}
