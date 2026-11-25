"use client";

// Line chart following the dataviz rules: one axis, 2px lines, >=8px end
// markers with a surface ring, hairline solid grid, crosshair snapping to the
// nearest X with one tooltip listing every series, a legend for 2+ series, and
// a table view so no value is hover-only.

import { useMemo, useRef, useState } from "react";

export interface Series {
  id: string;
  label: string;
  /** A CSS color, normally var(--series-N) in the fixed platform order. */
  color: string;
  /** One value per x position; null = no data. */
  values: (number | null)[];
}

export function LineChart({
  x,
  series,
  yDomain,
  invert = false,
  height = 220,
  format = (n) => String(n),
  ariaLabel,
  toggleable = true,
  initiallyHidden = [],
}: {
  /** X labels (already formatted), one per position. */
  x: string[];
  series: Series[];
  yDomain?: [number, number];
  /** Rank positions: 1 at the top. */
  invert?: boolean;
  height?: number;
  format?: (n: number) => string;
  ariaLabel: string;
  toggleable?: boolean;
  initiallyHidden?: string[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set(initiallyHidden));
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const ref = useRef<SVGSVGElement>(null);
  const W = 760;
  const H = height;
  const pad = { l: 36, r: 16, t: 12, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const visible = series.filter((s) => !hidden.has(s.id));

  const [lo, hi] = useMemo(() => {
    if (yDomain) return yDomain;
    const vals = visible.flatMap((s) => s.values).filter((v): v is number => v != null);
    if (!vals.length) return [0, 1];
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    return invert ? [1, Math.max(10, Math.ceil(max / 10) * 10)] : [Math.min(0, min), max <= 100 && min >= 0 ? 100 : max];
  }, [yDomain, visible, invert]);

  const xPos = (i: number) => pad.l + (x.length <= 1 ? iw / 2 : (i / (x.length - 1)) * iw);
  const yPos = (v: number) => {
    const t = (v - lo) / (hi - lo || 1);
    return invert ? pad.t + t * ih : pad.t + ih - t * ih;
  };
  const ticks = useMemo(() => {
    if (invert) {
      // Rank positions: #1 plus round steps (5, 10, 15... or 10, 20...).
      const step = hi <= 20 ? 5 : 10;
      const out = [1];
      for (let t = step; t <= hi; t += step) out.push(t);
      return out;
    }
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => Math.round(lo + ((hi - lo) * i) / n));
  }, [lo, hi, invert]);
  const xTicks = x.length <= 6 ? x.map((_, i) => i) : [0, Math.floor((x.length - 1) / 2), x.length - 1];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !x.length) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = x.length <= 1 ? 0 : Math.round(((px - pad.l) / iw) * (x.length - 1));
    setHover(Math.max(0, Math.min(x.length - 1, i)));
  };

  const path = (s: Series) => {
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const lastIdx = (s: Series) => {
    for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) return i;
    return -1;
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
        {series.length > 1 && (
          <div className="legend" role="group" aria-label="Series" style={{ flex: 1 }}>
            {series.map((s) => (
              <button
                key={s.id}
                aria-pressed={!hidden.has(s.id)}
                onClick={() => {
                  if (!toggleable) return;
                  const n = new Set(hidden);
                  if (n.has(s.id)) n.delete(s.id);
                  else n.add(s.id);
                  setHidden(n);
                }}
              >
                <span className="line-key" style={{ background: s.color }} />
                {s.label}
              </button>
            ))}
          </div>
        )}
        {series.length <= 1 && <span className="spacer" />}
        <button className="btn btn-sm btn-ghost" style={{ flex: "none" }} onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? "Chart" : "Table"}
        </button>
      </div>

      {table ? (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Date</th>
                {series.map((s) => (
                  <th key={s.id} style={{ textAlign: "right" }}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {x.map((label, i) => (
                <tr key={i}>
                  <td>{label}</td>
                  {series.map((s) => (
                    <td key={s.id} style={{ textAlign: "right" }}>{s.values[i] == null ? "" : format(s.values[i]!)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap">
          <svg
            ref={ref}
            viewBox={`0 0 ${W} ${H}`}
            className="chart"
            role="img"
            aria-label={ariaLabel}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            tabIndex={0}
            onFocus={() => setHover(x.length - 1)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? x.length - 1) - 1));
              if (e.key === "ArrowRight") setHover((h) => Math.min(x.length - 1, (h ?? 0) + 1));
            }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className={t === (invert ? hi : lo) ? "baseline" : "gridline"} x1={pad.l} x2={W - pad.r} y1={yPos(t)} y2={yPos(t)} />
                <text x={pad.l - 8} y={yPos(t) + 4} textAnchor="end">
                  {invert ? `#${t}` : format(t)}
                </text>
              </g>
            ))}
            {xTicks.map((i) => (
              <text key={i} x={xPos(i)} y={H - 6} textAnchor={i === 0 && x.length > 1 ? "start" : i === x.length - 1 && x.length > 1 ? "end" : "middle"}>
                {x[i]}
              </text>
            ))}
            {hover != null && <line className="crosshair" x1={xPos(hover)} x2={xPos(hover)} y1={pad.t} y2={pad.t + ih} />}
            {visible.map((s) => {
              const li = lastIdx(s);
              return (
                <g key={s.id}>
                  <path d={path(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {x.length === 1 && s.values[0] != null && <circle cx={xPos(0)} cy={yPos(s.values[0]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
                  {li >= 0 && x.length > 1 && <circle cx={xPos(li)} cy={yPos(s.values[li]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
                  {hover != null && s.values[hover] != null && <circle cx={xPos(hover)} cy={yPos(s.values[hover]!)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
                </g>
              );
            })}
          </svg>
          {hover != null && (
            <div
              className="chart-tip"
              style={{
                left: `${(xPos(hover) / W) * 100}%`,
                top: 0,
                transform: `translate(${hover > x.length / 2 ? "calc(-100% - 12px)" : "12px"}, 0)`,
              }}
            >
              <div className="tip-date">{x[hover]}</div>
              {visible.map((s) => (
                <div className="tip-row" key={s.id}>
                  <span className="line-key" style={{ background: s.color }} />
                  <b>{s.values[hover] == null ? "n/a" : invert ? `#${s.values[hover]}` : format(s.values[hover]!)}</b>
                  {s.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Single-series horizontal distribution (e.g. ranking buckets): proportional segments with labels. */
export function Distribution({ parts, ariaLabel }: { parts: { label: string; value: number; color: string }[]; ariaLabel: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div>
      <div className="dist" role="img" aria-label={ariaLabel}>
        {total === 0 ? <span style={{ flex: 1, background: "var(--surface-3)" }} /> : parts.filter((p) => p.value > 0).map((p) => <span key={p.label} style={{ flex: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />)}
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        {parts.map((p) => (
          <span key={p.label} className="row" style={{ gap: 6 }}>
            <span className="dot" style={{ background: p.color, borderRadius: 2 }} />
            {p.label} <b style={{ color: "var(--text)" }}>{p.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Half-circle gauge for a 0-100 share (visibility, sentiment). The arc is split into tone bands so the reading has a
 * frame of reference; the value is the large number, not the needle, so it's readable without color.
 */
export function Gauge({
  value,
  label,
  sub,
  bands = [
    { to: 25, color: "var(--fail)" },
    { to: 60, color: "var(--warn)" },
    { to: 100, color: "var(--pass)" },
  ],
  format = (n) => `${n}%`,
}: {
  value: number | null;
  label: string;
  sub?: string;
  bands?: { to: number; color: string }[];
  format?: (n: number) => string;
}) {
  const W = 240;
  const R = 92;
  const cx = W / 2;
  const cy = 112;
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const pt = (pct: number, r = R) => {
    const a = Math.PI * (1 - pct / 100);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from);
    const [x2, y2] = pt(to);
    return `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
  };
  const tone = v == null ? "var(--text-3)" : (bands.find((b) => v <= b.to) ?? bands.at(-1)!).color;
  return (
    <figure className="gauge" aria-label={`${label}: ${v == null ? "no data" : format(v)}`} role="img">
      <svg viewBox={`0 0 ${W} 128`} aria-hidden="true">
        <path d={arc(0, 100)} className="gauge-track" />
        {v != null && v > 0 && <path d={arc(0, v)} stroke={tone} className="gauge-fill" />}
        {bands.slice(0, -1).map((b) => {
          const [x, y] = pt(b.to, R + 13);
          return <circle key={b.to} cx={x} cy={y} r={2} fill="var(--line-strong)" />;
        })}
        {v != null && (() => {
          const [x, y] = pt(v, R - 22);
          return <line x1={cx} y1={cy} x2={x} y2={y} className="gauge-needle" />;
        })()}
        <circle cx={cx} cy={cy} r={4} fill="var(--text)" />
        <text x={cx - R} y={cy + 14} textAnchor="middle">0</text>
        <text x={cx + R} y={cy + 14} textAnchor="middle">100</text>
      </svg>
      <figcaption>
        <b style={{ color: tone }}>{v == null ? "–" : format(v)}</b>
        <span>{sub ?? label}</span>
      </figcaption>
    </figure>
  );
}

/** Stacked columns over time (one column per run), as shares of each column's total, with a table view. */
export function StackedBars({
  x,
  series,
  ariaLabel,
  height = 220,
}: {
  x: string[];
  series: Series[];
  ariaLabel: string;
  height?: number;
}) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const W = 760;
  const H = height;
  const pad = { l: 36, r: 12, t: 10, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const totals = x.map((_, i) => series.reduce((s, se) => s + (se.values[i] ?? 0), 0));
  const slot = iw / Math.max(1, x.length);
  const bw = Math.min(64, slot * 0.6);
  const share = (v: number, i: number) => (totals[i] ? (v / totals[i]) * 100 : 0);
  const shown = series.filter((s) => s.values.some((v) => v));
  return (
    <div>
      <div className="row" style={{ marginBottom: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
        <div className="legend" style={{ flex: 1 }}>
          {shown.map((s) => (
            <span key={s.id} className="row" style={{ gap: 6 }}>
              <span className="dot" style={{ background: s.color, borderRadius: 2 }} />
              {s.label}
            </span>
          ))}
        </div>
        <button className="btn btn-sm btn-ghost" style={{ flex: "none" }} onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? "Chart" : "Table"}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Run</th>
                {shown.map((s) => <th key={s.id} style={{ textAlign: "right" }}>{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {x.map((l, i) => (
                <tr key={i}>
                  <td>{l}</td>
                  {shown.map((s) => <td key={s.id} style={{ textAlign: "right" }}>{s.values[i] ? `${s.values[i]} (${Math.round(share(s.values[i]!, i))}%)` : ""}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
            {[0, 25, 50, 75, 100].map((t) => {
              const y = pad.t + ih - (t / 100) * ih;
              return (
                <g key={t}>
                  <line className={t === 0 ? "baseline" : "gridline"} x1={pad.l} x2={W - pad.r} y1={y} y2={y} />
                  <text x={pad.l - 8} y={y + 4} textAnchor="end">{t}%</text>
                </g>
              );
            })}
            {x.map((l, i) => {
              const cx = pad.l + slot * i + slot / 2;
              let acc = 0;
              return (
                <g key={i} onPointerEnter={() => setHover(i)}>
                  <rect x={cx - slot / 2} y={pad.t} width={slot} height={ih} fill="transparent" />
                  {shown.map((s) => {
                    const v = share(s.values[i] ?? 0, i);
                    if (!v) return null;
                    const y = pad.t + ih - ((acc + v) / 100) * ih;
                    acc += v;
                    return <rect key={s.id} x={cx - bw / 2} y={y} width={bw} height={Math.max(0, (v / 100) * ih - 1)} fill={s.color} rx={1.5} />;
                  })}
                  <text x={cx} y={H - 6} textAnchor="middle">{l}</text>
                </g>
              );
            })}
          </svg>
          {hover != null && totals[hover] > 0 && (
            <div className="chart-tip" style={{ left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%`, top: 0, transform: `translate(${hover > x.length / 2 ? "calc(-100% - 12px)" : "12px"}, 0)` }}>
              <div className="tip-date">{x[hover]} · {totals[hover]} citations</div>
              {shown.filter((s) => s.values[hover]).sort((a, b) => (b.values[hover] ?? 0) - (a.values[hover] ?? 0)).map((s) => (
                <div className="tip-row" key={s.id}>
                  <span className="line-key" style={{ background: s.color }} />
                  <b>{Math.round(share(s.values[hover]!, hover))}%</b>
                  {s.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars with the value at the end: for "top N" lists where the label matters more than the axis. */
export function HBars({ items, format = (n) => String(n), color = "var(--accent)" }: { items: { label: string; value: number; href?: string; title?: string }[]; format?: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="hbars">
      {items.map((i) => (
        <div className="hbar" key={i.label} title={i.title ?? i.label}>
          <span className="hbar-label">{i.href ? <a href={i.href} target="_blank" rel="noreferrer">{i.label}</a> : i.label}</span>
          <span className="hbar-track"><span style={{ width: `${(i.value / max) * 100}%`, background: color }} /></span>
          <b className="mono small">{format(i.value)}</b>
        </div>
      ))}
    </div>
  );
}
