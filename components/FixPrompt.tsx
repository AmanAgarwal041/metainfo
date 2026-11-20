"use client";

import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { fixesPrompt, fixPrompt, MAX_FIXES, type Fix, type PromptContext } from "@/lib/fix-prompts";
import { CopyButton } from "./ui";

// Prompts for AI coding assistants: one per fix ("Prompt"), or several picked fixes in one ("Prompt for N fixes").

const approxTokens = (s: string) => Math.round(s.length / 4 / 10) * 10 || s.length;

function PromptBox({ text, onClose }: { text: string; onClose?: () => void }) {
  return (
    <div className="prompt-box" onClick={(e) => e.stopPropagation()}>
      <div className="prompt-box-head">
        <span className="small muted">Paste into Claude Code, Cursor or another assistant · about {approxTokens(text)} tokens</span>
        <span className="spacer" />
        <CopyButton text={text} label="Copy prompt" />
        {onClose && (
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <pre>{text}</pre>
    </div>
  );
}

/** "Prompt" for one fix: shows it inline, ready to copy. */
export function FixPromptButton({ fix, ctx }: { fix: Fix; ctx: PromptContext }) {
  const [open, setOpen] = useState(false);
  const text = useMemo(() => (open ? fixPrompt(fix, ctx) : ""), [open, fix, ctx]);
  return (
    <div className="fix-prompt">
      <button
        type="button"
        className="btn btn-sm"
        aria-expanded={open}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(!open);
        }}
      >
        {open ? "Hide prompt" : "Prompt for this fix"}
      </button>
      {open && <PromptBox text={text} />}
    </div>
  );
}

/** Which fixes are picked for a collated prompt. */
export function useFixPicker() {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string, on: boolean) => {
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }, []);
  const set = useCallback((ids: string[]) => setPicked(new Set(ids)), []);
  return { picked, toggle, set };
}

export type FixPicker = ReturnType<typeof useFixPicker>;

/** A checkbox that picks a fix for the collated prompt. Safe inside <summary> and buttons' neighbours. */
export function PickBox({ id, title, picker }: { id: string; title: string; picker: FixPicker }) {
  return (
    <label className="fix-pick" title="Add to a combined prompt" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={picker.picked.has(id)} onChange={(e) => picker.toggle(id, e.currentTarget.checked)} aria-label={`Add “${title}” to the combined prompt`} />
    </label>
  );
}

/**
 * The bar above a list of fixes: one prompt for the picked ones, or for the top ones when none are picked.
 * `fixes` is in priority order.
 */
export function CollatedPrompt({ fixes, ctx, picker }: { fixes: Fix[]; ctx: PromptContext; picker: FixPicker }) {
  const [open, setOpen] = useState(false);
  const chosen = fixes.filter((f) => picker.picked.has(f.id));
  const using = chosen.length ? chosen : fixes;
  const text = useMemo(() => fixesPrompt(using, ctx), [using, ctx]);
  if (!fixes.length) return null;
  const count = Math.min(using.length, MAX_FIXES);
  const label = chosen.length ? `${chosen.length} picked` : fixes.length > MAX_FIXES ? `top ${MAX_FIXES} of ${fixes.length}` : `all ${fixes.length}`;
  return (
    <div className="fix-collate">
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="small">
          <b>Fix prompt</b> <span className="muted">· {label}{chosen.length ? "" : " (tick fixes to choose)"}</span>
        </span>
        <span className="spacer" />
        <CopyButton text={text} label={`Copy prompt for ${count} ${count === 1 ? "fix" : "fixes"}`} className="btn btn-sm btn-primary" />
        <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide" : "View"}
        </button>
        {chosen.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => picker.set([])}>
            Clear
          </button>
        )}
        {!chosen.length && fixes.length > 1 && (
          <button type="button" className="btn btn-sm" onClick={() => picker.set(fixes.slice(0, MAX_FIXES).map((f) => f.id))}>
            Pick all
          </button>
        )}
      </div>
      {open && <PromptBox text={text} onClose={() => setOpen(false)} />}
    </div>
  );
}
