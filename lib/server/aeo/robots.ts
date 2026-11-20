// Just enough robots.txt for "may this crawler fetch this path": groups by user-agent token, longest matching
// Allow/Disallow wins, `*` and `$` supported (RFC 9309).

export interface RobotsRules {
  groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[];
}

export function parseRobots(txt: string): RobotsRules {
  const groups: RobotsRules["groups"] = [];
  let cur: RobotsRules["groups"][number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && cur) {
      lastWasAgent = false;
      if (val || key === "allow") cur.rules.push({ allow: key === "allow", path: val });
    } else {
      lastWasAgent = false;
    }
  }
  return { groups };
}

const toRe = (p: string) => new RegExp(`^${p.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$|\$$/, "$")}`);

/** `token` is the crawler's robots token (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Googlebot...). */
export function allowed(rules: RobotsRules, token: string, path: string): boolean {
  const t = token.toLowerCase();
  const group = rules.groups.find((g) => g.agents.includes(t)) ?? rules.groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const r of group.rules) {
    if (!r.path) continue;
    if (toRe(r.path).test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
  }
  return best?.allow ?? true;
}
