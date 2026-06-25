import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPlayer,
  fetchPlayerGames,
  fetchProfilesByIds,
} from "@/services/admin";
import {
  fetchPlayer360,
  fetchPlayerAudit,
  grantCoin,
  refundStake,
  suspendPlayer,
  type Stake,
} from "@/services/auth";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Flame,
  Trophy,
  Wallet as WalletIcon,
  Mail,
  Lock,
  ArrowDownCircle,
  ArrowUpCircle,
  Sparkles,
  PlusCircle,
  MinusCircle,
  Ban,
  ShieldCheck,
  RotateCcw,
  ScrollText,
  Coins,
} from "lucide-react";
import { fmtCoin, fmtDate, fmtNum, fmtRelative, clsx } from "@/lib/format";
import { Avatar } from "@/pages/Overview";
import { Kpi, Section, ErrorBox, Skeleton, Empty } from "@/components/ui";
import CountUp from "@/components/CountUp";
import { ActionModal, type ActionConfirmField } from "@/components/ActionModal";
import { useToast } from "@/components/Toast";

const TX_PALETTE: Record<string, string> = {
  starting_bonus: "text-accent-mint",
  welcome_bonus: "text-accent-mint",
  daily_bonus: "text-accent-mint",
  win: "text-accent-mint",
  loss: "text-accent-rose",
  stake_lock: "text-accent-sky",
  stake_refund: "text-accent-sky",
  stake_payout: "text-gold-200",
  commission: "text-gold-400",
  referral: "text-accent-mint",
  admin_grant: "text-gold-200",
  admin_refund: "text-accent-sky",
  admin_adjustment: "text-accent-rose",
};

type ModalKind = null | "grant" | "deduct" | "suspend" | "unsuspend";

export default function PlayerDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<ModalKind>(null);
  const [refundTarget, setRefundTarget] = useState<Stake | null>(null);
  // Hoist idempotency_key per opened modal/refund instance so retries reuse the same key (FIND-045).
  const grantIdem = useMemo(() => (modal === "grant" || modal === "deduct" ? crypto.randomUUID() : ""), [modal]);
  const suspendIdem = useMemo(() => (modal === "suspend" || modal === "unsuspend" ? crypto.randomUUID() : ""), [modal]);
  const refundIdem = useMemo(() => (refundTarget ? crypto.randomUUID() : ""), [refundTarget]);

  const player = useQuery({ queryKey: ["player", id], queryFn: () => fetchPlayer(id) });

  const live360 = useQuery({
    queryKey: ["player-360", id],
    queryFn: () => fetchPlayer360(id),
    enabled: !!id,
    refetchInterval: 20_000,
  });

  const games = useQuery({
    queryKey: ["player-games", id],
    queryFn: () => fetchPlayerGames(id, 25),
    enabled: !!id,
  });

  const auditQ = useQuery({
    queryKey: ["player-audit", id],
    queryFn: () => fetchPlayerAudit(id),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  const oppIds = (games.data ?? [])
    .map((g) => (g.white_player_id === id ? g.black_player_id : g.white_player_id))
    .filter(Boolean) as string[];
  const opps = useQuery({
    queryKey: ["player-opp-profiles", oppIds.sort().join(",")],
    queryFn: () => fetchProfilesByIds(oppIds),
    enabled: oppIds.length > 0,
  });

  if (player.isLoading) return <Skeleton rows={6} />;
  const p = player.data;
  if (!p) {
    return (
      <div className="space-y-5">
        <BackLink />
        <ErrorBox message="Игрок не найден или скрыт RLS." />
      </div>
    );
  }

  const wr = p.total_games > 0 ? Math.round((p.wins / p.total_games) * 100) : 0;
  const full = live360.data;
  const wallet = full?.wallet;
  const txs = full?.transactions ?? [];
  const stakes = full?.stakes ?? [];
  const fullProfile = full?.profile;
  const suspendedUntil = fullProfile?.suspended_until ?? null;
  const isSuspended = !!suspendedUntil && new Date(suspendedUntil) > new Date();

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["player-360", id] });
    qc.invalidateQueries({ queryKey: ["player-audit", id] });
    qc.invalidateQueries({ queryKey: ["player", id] });
  }

  return (
    <div className="space-y-7">
      <BackLink />

      {/* Suspension banner */}
      {isSuspended && (
        <div className="panel p-5 border-accent-rose/30 bg-accent-rose/[0.06] flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg border border-accent-rose/40 bg-accent-rose/10 flex items-center justify-center shrink-0">
            <Ban className="w-4 h-4 text-accent-rose" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-accent-rose tracking-tight">Игрок приостановлен</div>
            <div className="text-[12px] text-ink-300 mt-0.5">
              До <span className="mono text-ink-100">{fmtDate(suspendedUntil!)}</span>{" "}
              <span className="text-ink-500">({fmtRelative(suspendedUntil!)})</span>
            </div>
            {fullProfile?.suspension_reason && (
              <div className="text-[12px] text-ink-400 mt-1 italic">
                Причина: «{fullProfile.suspension_reason}»
              </div>
            )}
            {fullProfile?.suspended_by && (
              <div className="text-[11px] text-ink-500 mt-0.5 mono">
                актор: {fullProfile.suspended_by}
              </div>
            )}
          </div>
          <button
            onClick={() => setModal("unsuspend")}
            className="px-3 py-2 rounded-lg text-[12px] inline-flex items-center gap-2 bg-accent-mint/10 border border-accent-mint/30 text-accent-mint hover:bg-accent-mint/20"
            data-testid="unsuspend-btn"
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Снять блок
          </button>
        </div>
      )}

      {/* Hero */}
      <div className="panel p-7">
        <div className="flex items-start gap-6">
          <div className="scale-[1.6] origin-top-left">
            <Avatar idx={p.avatar_index} name={p.nickname} />
          </div>
          <div className="flex-1 min-w-0 ml-6">
            <div className="text-[11px] uppercase tracking-[0.18em] text-gold-300/80 mb-2">
              Профиль игрока
            </div>
            <h1 className="display-title text-3xl text-ink-50">
              {p.display_name || p.nickname}
            </h1>
            <div className="mt-1 text-sm text-ink-400 mono break-all">{p.id}</div>
            <div className="mt-5 flex flex-wrap gap-2">
              {fullProfile?.email ? (
                <span className="chip-gold">
                  <Mail className="w-3 h-3" /> {fullProfile.email}
                </span>
              ) : (
                <span className="chip-mute">
                  <Mail className="w-3 h-3" /> без email (anonymous)
                </span>
              )}
              <span className="chip-mute">
                <Calendar className="w-3 h-3" /> {fmtDate(p.created_at)}
              </span>
              <span className="chip-mute">
                <Clock className="w-3 h-3" /> {fmtRelative(p.last_seen_at)}
              </span>
              {p.best_win_streak > 0 && (
                <span className="chip-gold">
                  <Flame className="w-3 h-3" /> лучший стрик {p.best_win_streak}
                </span>
              )}
              {fullProfile?.login_streak ? (
                <span className="chip-mint">
                  <Sparkles className="w-3 h-3" /> login streak {fullProfile.login_streak}
                </span>
              ) : null}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={() => setModal("grant")}
              className="px-3 py-2 rounded-lg text-[12px] inline-flex items-center gap-2 bg-accent-mint/10 border border-accent-mint/30 text-accent-mint hover:bg-accent-mint/20 transition-all"
              data-testid="grant-coin-btn"
            >
              <PlusCircle className="w-3.5 h-3.5" /> Начислить Coin
            </button>
            <button
              onClick={() => setModal("deduct")}
              className="px-3 py-2 rounded-lg text-[12px] inline-flex items-center gap-2 bg-white/[0.03] border border-white/[0.08] text-ink-300 hover:bg-white/[0.06] transition-all"
              data-testid="deduct-coin-btn"
            >
              <MinusCircle className="w-3.5 h-3.5" /> Списать
            </button>
            {!isSuspended && (
              <button
                onClick={() => setModal("suspend")}
                className="px-3 py-2 rounded-lg text-[12px] inline-flex items-center gap-2 bg-accent-rose/10 border border-accent-rose/30 text-accent-rose hover:bg-accent-rose/20 transition-all"
                data-testid="suspend-btn"
              >
                <Ban className="w-3.5 h-3.5" /> Заблокировать
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Wallet hero */}
      <div className="panel p-7 relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-72 h-72 rounded-full bg-gradient-to-br from-gold-400/20 to-transparent blur-3xl pointer-events-none" />
        <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-end">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-gold-300/80 mb-2 flex items-center gap-2">
              <WalletIcon className="w-3 h-3" />
              Кошелёк · live · service_role
            </div>
            {live360.isLoading ? (
              <div className="display-title text-6xl text-ink-200">…</div>
            ) : wallet ? (
              <>
                <div className="display-title text-6xl text-gold-200 leading-none">
                  <CountUp value={Number(wallet.crypto_balance)} format={fmtCoin} />{" "}
                  <span className="text-ink-400 text-2xl">Coin</span>
                </div>
                <div className="mt-3 text-sm text-ink-400">
                  В locked:{" "}
                  <span className="mono text-accent-sky">
                    <CountUp value={Number(wallet.locked_balance)} format={fmtCoin} />
                  </span>{" "}
                  · обновлено {fmtRelative(wallet.updated_at)}
                </div>
              </>
            ) : (
              <div className="text-ink-500 text-sm">Кошелёк не найден.</div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 min-w-[240px]">
            <Kpi label="Выиграно" value={<CountUp value={Number(wallet?.total_won ?? 0)} format={fmtCoin} />} tone="mint" />
            <Kpi label="Проиграно" value={<CountUp value={Number(wallet?.total_lost ?? 0)} format={fmtCoin} />} tone="rose" />
          </div>
        </div>
      </div>

      {/* Game KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi icon={<Trophy className="w-4 h-4" />} label="Рейтинг" value={<CountUp value={p.rating} />} tone="gold" />
        <Kpi label="Партий" value={<CountUp value={p.total_games} />} />
        <Kpi
          label="Win rate"
          value={p.total_games > 0 ? `${wr}%` : "—"}
          tone={wr >= 60 ? "mint" : wr >= 40 ? "default" : "rose"}
        />
        <Kpi label="Текущий стрик" value={<CountUp value={p.win_streak} />} tone="gold" />
      </div>

      {/* Stakes — admin can refund */}
      <Section
        title="Ставочные партии"
        description={`${stakes.length} последних · refund доступен пока escrow != paid`}
      >
        {stakes.length === 0 ? (
          <Empty message="Ставочных партий не было" icon={<Coins className="w-8 h-8" />} />
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {stakes.map((s) => {
              const canRefund =
                s.escrow_status !== "refunded" && s.payout_status !== "paid";
              const color = s.white_profile_id === id ? "white" : "black";
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-4 px-2 py-3 row-hover rounded-lg"
                >
                  <div className={clsx("w-2 h-2 rounded-full", color === "white" ? "bg-gold-200" : "bg-ink-300")} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink-100 mono">
                      ставка {fmtCoin(Number(s.entry_fee))} · pot {fmtCoin(Number(s.pot_amount))}
                    </div>
                    <div className="text-[11px] text-ink-500 mt-0.5">
                      escrow: <span className="text-ink-300">{s.escrow_status}</span> · payout:{" "}
                      <span className="text-ink-300">{s.payout_status}</span> ·{" "}
                      {fmtRelative(s.created_at)}{" "}
                      <Link to={`/matches/${s.game_id}`} className="text-ink-400 underline ml-1">
                        → партия
                      </Link>
                    </div>
                  </div>
                  {canRefund ? (
                    <button
                      onClick={() => setRefundTarget(s)}
                      className="px-3 py-1.5 rounded-lg text-[11px] inline-flex items-center gap-1.5 bg-accent-sky/10 border border-accent-sky/30 text-accent-sky hover:bg-accent-sky/20"
                      data-testid={`refund-stake-${s.id}`}
                    >
                      <RotateCcw className="w-3 h-3" /> Refund
                    </button>
                  ) : (
                    <span className="chip-mute text-[11px]">{s.escrow_status === "refunded" ? "refunded" : "paid"}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Transactions */}
      <Section
        title="История транзакций"
        description={
          live360.isLoading
            ? "загружаю…"
            : `${txs.length} последних движений Coin (полная история через service_role)`
        }
      >
        {live360.isLoading ? (
          <Skeleton rows={6} />
        ) : txs.length === 0 ? (
          <Empty message="Нет транзакций" />
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {txs.map((tx) => {
              const amt = Number(tx.amount);
              const positive = amt > 0;
              return (
                <li
                  key={tx.id}
                  className="flex items-center gap-4 px-2 py-3 row-hover rounded-lg"
                >
                  <span
                    className={clsx(
                      "w-7 h-7 rounded-full border flex items-center justify-center shrink-0",
                      positive
                        ? "bg-accent-mint/10 border-accent-mint/30 text-accent-mint"
                        : "bg-accent-rose/10 border-accent-rose/30 text-accent-rose",
                    )}
                  >
                    {positive ? <ArrowUpCircle className="w-3.5 h-3.5" /> : <ArrowDownCircle className="w-3.5 h-3.5" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className={clsx("mono", TX_PALETTE[tx.type] ?? "text-ink-200")}>
                        {tx.type}
                      </span>
                      {tx.note && (
                        <span className="text-ink-400 text-[12px] truncate">· {tx.note}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-500 mono mt-0.5">
                      {fmtRelative(tx.created_at)}{" "}
                      {tx.game_id && (
                        <Link to={`/matches/${tx.game_id}`} className="text-ink-400 underline ml-1">
                          → партия
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className={clsx("mono text-sm shrink-0 text-right", positive ? "text-accent-mint" : "text-accent-rose")}>
                    {positive ? "+" : ""}
                    {fmtCoin(amt)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Recent games */}
      <Section
        title="Недавние партии"
        description="Последние 25 партий"
      >
        {games.isLoading ? (
          <Skeleton rows={5} />
        ) : (games.data ?? []).length === 0 ? (
          <Empty message="Этот игрок ещё не сыграл онлайн-партий" />
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {(games.data ?? []).map((g) => {
              const myColor: "white" | "black" = g.white_player_id === id ? "white" : "black";
              const oppId = myColor === "white" ? g.black_player_id : g.white_player_id;
              const opp = oppId ? opps.data?.[oppId] : undefined;
              const result =
                g.winner === null ? "draw" : g.winner === myColor ? "win" : "loss";
              return (
                <li key={g.id}>
                  <Link to={`/matches/${g.id}`} className="flex items-center gap-4 px-3 py-3 row-hover rounded-lg">
                    <div className={clsx("w-2 h-2 rounded-full", myColor === "white" ? "bg-gold-200" : "bg-ink-300")} />
                    <div className="mono text-xs text-ink-300 w-20">{g.room_code}</div>
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                      {opp ? (
                        <>
                          <Avatar idx={opp.avatar_index} name={opp.nickname} />
                          <div className="min-w-0">
                            <div className="text-sm text-ink-100 truncate">vs {opp.nickname}</div>
                            <div className="text-[11px] text-ink-500">
                              {fmtNum(g.move_number)} ходов · {fmtRelative(g.updated_at)}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-ink-500">vs (нет соперника)</div>
                      )}
                    </div>
                    <span
                      className={clsx(
                        "chip",
                        result === "win"
                          ? "bg-accent-mint/10 border-accent-mint/30 text-accent-mint"
                          : result === "loss"
                            ? "bg-accent-rose/10 border-accent-rose/30 text-accent-rose"
                            : "bg-white/[0.03] border-white/10 text-ink-300",
                      )}
                    >
                      {result === "win" ? "победа" : result === "loss" ? "проигрыш" : "ничья"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Audit history */}
      <Section
        title="Журнал админ-действий"
        description="Все действия по этому игроку, выполненные через защищённый API"
      >
        {auditQ.isLoading ? (
          <Skeleton rows={3} />
        ) : (auditQ.data?.rows ?? []).length === 0 ? (
          <Empty message="Ничего не было выполнено" icon={<ScrollText className="w-7 h-7" />} />
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {(auditQ.data?.rows ?? []).map((a) => (
              <li key={a.id} className="px-2 py-3 row-hover rounded-lg">
                <div className="flex items-center gap-3 text-sm">
                  <span className="mono text-gold-200">{a.action}</span>
                  <span
                    className={clsx(
                      "chip text-[10px]",
                      a.status === "success"
                        ? "bg-accent-mint/10 border-accent-mint/30 text-accent-mint"
                        : "bg-accent-rose/10 border-accent-rose/30 text-accent-rose",
                    )}
                  >
                    {a.status}
                  </span>
                  <span className="text-ink-400 text-[12px] truncate">
                    {a.actor_email}
                  </span>
                  <span className="ml-auto text-[11px] text-ink-500 mono">
                    {fmtRelative(a.created_at)}
                  </span>
                </div>
                {a.reason && (
                  <div className="text-[12px] text-ink-400 mt-1 italic">«{a.reason}»</div>
                )}
                {a.error && (
                  <div className="text-[11px] text-accent-rose mono mt-1">err: {a.error}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="panel p-6 flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent-mint/10 border border-accent-mint/30 flex items-center justify-center shrink-0">
          <Lock className="w-4 h-4 text-accent-mint" />
        </div>
        <div className="text-sm text-ink-300 leading-relaxed">
          Все мутации (grant / refund / suspend) идут через{" "}
          <span className="mono text-ink-100">/api/admin/*</span> на Cloudflare Pages Function с
          <span className="mono text-ink-100"> service_role</span> и пишутся в{" "}
          <span className="mono text-ink-100">admin_audit_log</span>{" "}
          с idempotency_key. Каждое действие — атомарная SQL-функция.
        </div>
      </div>

      {/* ── Modals ───────────────────────────── */}
      <ActionModal
        open={modal === "grant"}
        title="Начислить Coin"
        description={`Начисление будет проведено как admin_grant и записано в audit-лог. Игрок: ${p.nickname}.`}
        tone="warn"
        cta="Начислить"
        fields={GRANT_FIELDS as ActionConfirmField[]}
        onClose={() => setModal(null)}
        onSubmit={async (v) => {
          const amount = Number(v.amount);
          await grantCoin(id, amount, v.reason, grantIdem);
          toast.push({
            kind: "info",
            title: `+${fmtCoin(amount)} Coin начислено`,
            description: v.reason,
          });
          invalidate();
        }}
      />

      <ActionModal
        open={modal === "deduct"}
        title="Списать Coin"
        description={`Списание ≤ текущего баланса. Будет проведено как admin_adjustment.`}
        tone="danger"
        cta="Списать"
        fields={DEDUCT_FIELDS as ActionConfirmField[]}
        onClose={() => setModal(null)}
        onSubmit={async (v) => {
          const amount = -Math.abs(Number(v.amount));
          await grantCoin(id, amount, v.reason, grantIdem);
          toast.push({
            kind: "warn",
            title: `${fmtCoin(amount)} Coin списано`,
            description: v.reason,
          });
          invalidate();
        }}
      />

      <ActionModal
        open={modal === "suspend"}
        title="Заблокировать игрока"
        description="Soft-suspension. Пока активна — игрок не может играть. Снимается одной кнопкой."
        tone="danger"
        cta="Заблокировать"
        fields={SUSPEND_FIELDS as ActionConfirmField[]}
        onClose={() => setModal(null)}
        onSubmit={async (v) => {
          const hours = parseInt(v.hours, 10) || 24;
          await suspendPlayer(id, hours, v.reason, suspendIdem);
          toast.push({
            kind: "warn",
            title: `Игрок заблокирован на ${hours}ч`,
            description: v.reason,
          });
          invalidate();
        }}
      />

      <ActionModal
        open={modal === "unsuspend"}
        title="Снять блокировку"
        description="Игрок снова сможет играть."
        tone="default"
        cta="Снять блок"
        fields={[
          {
            kind: "text",
            name: "reason",
            label: "Причина (для audit-лога)",
            placeholder: "напр.: апелляция принята",
            multiline: true,
          },
        ]}
        onClose={() => setModal(null)}
        onSubmit={async (v) => {
          await suspendPlayer(id, 0, v.reason || "unsuspend", suspendIdem);
          toast.push({ kind: "info", title: "Блокировка снята" });
          invalidate();
        }}
      />

      <ActionModal
        open={!!refundTarget}
        title={`Refund ставки ${refundTarget ? fmtCoin(Number(refundTarget.entry_fee)) : ""} Coin`}
        description={
          refundTarget
            ? `Вернёт ${fmtCoin(Number(refundTarget.entry_fee))} Coin обеим сторонам, статус → refunded.`
            : ""
        }
        tone="warn"
        cta="Вернуть ставку"
        fields={[
          {
            kind: "text",
            name: "reason",
            label: "Причина (обязательно)",
            placeholder: "напр.: техническая ошибка / спор / отмена матча",
            multiline: true,
          },
        ]}
        onClose={() => setRefundTarget(null)}
        onSubmit={async (v) => {
          if (!refundTarget) return;
          await refundStake(refundTarget.id, v.reason, refundIdem);
          toast.push({
            kind: "info",
            title: `Ставка ${fmtCoin(Number(refundTarget.entry_fee))} возвращена`,
            description: v.reason,
          });
          invalidate();
        }}
      />
    </div>
  );
}

const GRANT_FIELDS: ActionConfirmField[] = [
  {
    kind: "number",
    name: "amount",
    label: "Сумма Coin (положительное число)",
    placeholder: "100",
    min: 1,
    max: 1_000_000,
  },
  {
    kind: "text",
    name: "reason",
    label: "Причина (обязательно)",
    placeholder: "напр.: компенсация за обрыв матча #ABC123",
    multiline: true,
  },
];

const DEDUCT_FIELDS: ActionConfirmField[] = [
  {
    kind: "number",
    name: "amount",
    label: "Сумма к списанию (положительное число)",
    placeholder: "50",
    min: 1,
    max: 1_000_000,
  },
  {
    kind: "text",
    name: "reason",
    label: "Причина (обязательно)",
    placeholder: "напр.: возврат ошибочного бонуса",
    multiline: true,
  },
];

const SUSPEND_FIELDS: ActionConfirmField[] = [
  {
    kind: "select",
    name: "hours",
    label: "Длительность",
    defaultValue: 24,
    options: [
      { value: 1, label: "1 час" },
      { value: 6, label: "6 часов" },
      { value: 24, label: "24 часа (по умолчанию)" },
      { value: 72, label: "3 дня" },
      { value: 168, label: "7 дней" },
      { value: 720, label: "30 дней" },
    ],
  },
  {
    kind: "text",
    name: "reason",
    label: "Причина (обязательно)",
    placeholder: "напр.: подозрение в multi-account",
    multiline: true,
  },
];

function BackLink() {
  return (
    <Link to="/players" className="text-sm text-ink-400 hover:text-ink-100 inline-flex items-center gap-2">
      <ArrowLeft className="w-3.5 h-3.5" />
      ко всем игрокам
    </Link>
  );
}
