"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ flex: 1, minWidth: 260 }}>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

/**
 * Empty-state figure in the Hairline manner: one hairline stroke, opaque plates
 * painted back to front, a single accent mark, no words. The stack lifts on
 * hover with a distance-staggered 700ms ease and settles back at rest.
 */
export function StackFigure() {
  const [lift, setLift] = useState(false);
  // Isometric plate: a rhombus 120 wide, 60 deep, centred at (100, y).
  const plate = (y: number) => `M100 ${y - 30} L160 ${y} L100 ${y + 30} L40 ${y} Z`;
  const plates = [118, 100, 82];
  return (
    <svg className="figure" viewBox="0 0 200 160" onPointerEnter={() => setLift(true)} onPointerLeave={() => setLift(false)} aria-hidden>
      {plates.map((y, i) => (
        <g
          key={y}
          style={{
            transform: `translateY(${lift ? -i * 7 : 0}px)`,
            transition: `transform 700ms cubic-bezier(0.32, 0.72, 0, 1) ${i * 45}ms`,
          }}
        >
          <path className="hl hl-plate" d={plate(y)} />
          {i === plates.length - 1 && <path className="hl hl-accent" d={`M74 ${y + 4} L90 ${y - 6} L104 ${y + 1} L126 ${y - 12}`} />}
        </g>
      ))}
    </svg>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: { href?: string; label: string; onClick?: () => void } }) {
  return (
    <div className="empty-state">
      <StackFigure />
      <h3>{title}</h3>
      <p>{body}</p>
      {action &&
        (action.href ? (
          <Link className="btn btn-primary" href={action.href}>
            {action.label}
          </Link>
        ) : (
          <button className="btn btn-primary" onClick={action.onClick}>
            {action.label}
          </button>
        ))}
    </div>
  );
}

export function Kpi({ label, value, foot, tone }: { label: string; value: ReactNode; foot?: ReactNode; tone?: string }) {
  return (
    <div className="kpi">
      <div className="k-label">{label}</div>
      <div className="k-value" style={{ color: tone }}>{value}</div>
      {foot && <div className="k-foot">{foot}</div>}
    </div>
  );
}

export function Delta({ value, goodWhenUp = true, suffix = "" }: { value: number; goodWhenUp?: boolean; suffix?: string }) {
  if (!value) return <span className="muted">no change</span>;
  const good = value > 0 === goodWhenUp;
  return (
    <span style={{ color: good ? "var(--pass)" : "var(--fail)", fontWeight: 600 }}>
      {value > 0 ? "▲" : "▼"} {Math.abs(value)}
      {suffix}
    </span>
  );
}
