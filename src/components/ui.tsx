import { clsx } from "@/lib/format";
import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 mb-8">
      <div>
        {eyebrow && (
          <div className="text-[11px] uppercase tracking-[0.22em] text-gold-300/80 mb-3">
            {eyebrow}
          </div>
        )}
        <h1 className="display-title text-4xl md:text-[44px] leading-[1.05] text-ink-50">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-ink-400 mt-3 max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "gold" | "mint" | "rose";
  icon?: ReactNode;
}) {
  return (
    <div className="kpi">
      <div className="relative z-10">
        <div className="flex items-start justify-between">
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink-400">{label}</div>
          {icon && (
            <div className="w-8 h-8 rounded-lg border border-ink-700 bg-ink-900 flex items-center justify-center text-ink-300">
              {icon}
            </div>
          )}
        </div>
        <div
          className={clsx(
            "mt-4 display-title text-[40px] leading-none",
            tone === "gold" && "text-gold-200",
            tone === "mint" && "text-accent-mint",
            tone === "rose" && "text-accent-rose",
            tone === "default" && "text-ink-50",
          )}
        >
          {value}
        </div>
        {hint && <div className="mt-2 text-xs text-ink-400">{hint}</div>}
      </div>
    </div>
  );
}

export function Section({
  title,
  description,
  right,
  children,
}: {
  title: string;
  description?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="display-title text-xl text-ink-100">{title}</h2>
          {description && (
            <p className="text-xs text-ink-400 mt-1">{description}</p>
          )}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Empty({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 text-ink-400">
      {icon && <div className="mb-3 text-ink-500">{icon}</div>}
      <div className="text-sm">{message}</div>
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 rounded-lg bg-ink-800/70 animate-pulse"
          style={{ opacity: 1 - i * 0.08 }}
        />
      ))}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-accent-rose/30 bg-accent-rose/[0.06] p-4 text-sm text-accent-rose/90">
      {message}
    </div>
  );
}
