"use client";

import { useState } from "react";
import { PLATFORM_META, type Platform, type Severity, type Status } from "@/lib/types";

export function scoreColor(score: number): string {
  if (score >= 80) return "var(--pass)";
  if (score >= 55) return "var(--warn)";
  return "var(--fail)";
}

export function ScoreRing({ score, size = 96, stroke = 9, label }: { score: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${label ?? "Score"} ${score} out of 100`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreColor(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="ring-label">
        <div className="ring-value" style={{ fontSize: size * 0.3 }}>{score}</div>
        {label && <div className="muted" style={{ fontSize: Math.max(10, size * 0.11), marginTop: 2 }}>{label}</div>}
      </div>
    </div>
  );
}

const STATUS_GLYPH: Record<Status, string> = { pass: "✓", warn: "!", fail: "✕", info: "i" };

export function StatusIcon({ status }: { status: Status }) {
  return (
    <span className={`status-icon s-${status}`} aria-label={status}>
      {STATUS_GLYPH[status]}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge sev-${severity}`}>{severity}</span>;
}

export function PlatformChips({ platforms }: { platforms: Platform[] }) {
  return (
    <>
      {platforms.map((p) => (
        <span key={p} className="badge">
          <span className="dot" style={{ background: PLATFORM_META[p].color }} />
          {PLATFORM_META[p].short}
        </span>
      ))}
    </>
  );
}

export function CopyButton({ text, label = "Copy", className = "btn btn-sm" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="code">
      <CopyButton text={code} className="btn btn-sm copy" />
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function download(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function Sparkline({ values, width = 120, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="muted small spark">-</span>;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - (v / 100) * (height - 4)}`);
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} className="spark" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={scoreColor(last)} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}
