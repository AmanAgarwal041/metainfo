//! robots.txt parsing and matching per RFC 9309 / Google's implementation:
//! groups are selected by the most specific user-agent token, rules use `*`
//! and `$` wildcards, the longest matching rule wins and `Allow` wins ties.

use serde::Serialize;

#[derive(Debug, Clone, Default)]
pub struct Group {
    pub agents: Vec<String>,
    pub rules: Vec<Rule>,
}

#[derive(Debug, Clone)]
pub struct Rule {
    pub allow: bool,
    pub pattern: String,
}

#[derive(Debug, Clone, Default)]
pub struct Robots {
    pub groups: Vec<Group>,
    pub sitemaps: Vec<String>,
    pub warnings: Vec<String>,
    pub content_signals: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    pub allowed: bool,
    /// The user-agent group that applied (`*` for the wildcard group), if any.
    pub group: Option<String>,
    /// The deciding rule, e.g. `Disallow: /private`.
    pub rule: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RobotsReport {
    pub url: String,
    pub status: Option<u16>,
    pub found: bool,
    pub agents: Vec<String>,
    pub sitemaps: Vec<String>,
    pub warnings: Vec<String>,
    pub bytes: usize,
    pub body: Option<String>,
    pub content_signals: Vec<String>,
}

impl Robots {
    pub fn parse(body: &str) -> Robots {
        let mut r = Robots::default();
        let mut current: Option<Group> = None;
        let mut last_was_agent = false;

        for (n, raw_line) in body.lines().enumerate() {
            let line = raw_line.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            let Some((k, v)) = line.split_once(':') else {
                r.warnings.push(format!("Line {}: cannot parse `{}`", n + 1, line));
                continue;
            };
            let key = k.trim().to_ascii_lowercase();
            let val = v.trim().to_string();
            match key.as_str() {
                "user-agent" => {
                    if !last_was_agent {
                        if let Some(g) = current.take() {
                            r.groups.push(g);
                        }
                        current = Some(Group::default());
                    }
                    if let Some(g) = current.as_mut() {
                        g.agents.push(val.to_ascii_lowercase());
                    }
                    last_was_agent = true;
                }
                "allow" | "disallow" => {
                    last_was_agent = false;
                    match current.as_mut() {
                        Some(g) => {
                            // An empty Disallow means "allow everything" — no rule.
                            if !val.is_empty() {
                                g.rules.push(Rule { allow: key == "allow", pattern: val });
                            }
                        }
                        None => r.warnings.push(format!("Line {}: `{}` appears before any User-agent", n + 1, line)),
                    }
                }
                "sitemap" => {
                    // Sitemap is global and doesn't end the current group.
                    r.sitemaps.push(val);
                }
                "crawl-delay" => {
                    last_was_agent = false;
                    r.warnings.push(format!(
                        "Line {}: Crawl-delay is ignored by Google; Bing honours it and it can slow indexing",
                        n + 1
                    ));
                }
                "host" | "clean-param" => {
                    last_was_agent = false;
                }
                // contentsignals.org: declares permitted uses (search, ai-input, ai-train).
                "content-signal" => {
                    last_was_agent = false;
                    r.content_signals.push(val);
                }
                "noindex" | "nofollow" => {
                    last_was_agent = false;
                    r.warnings.push(format!(
                        "Line {}: `{}` in robots.txt is unsupported — use meta robots or X-Robots-Tag",
                        n + 1,
                        k.trim()
                    ));
                }
                other => {
                    last_was_agent = false;
                    r.warnings.push(format!("Line {}: unknown directive `{}`", n + 1, other));
                }
            }
        }
        if let Some(g) = current.take() {
            r.groups.push(g);
        }
        r
    }

    pub fn agents(&self) -> Vec<String> {
        let mut a: Vec<String> = self.groups.iter().flat_map(|g| g.agents.iter().cloned()).collect();
        a.sort();
        a.dedup();
        a
    }

    pub fn has_group_for(&self, token: &str) -> bool {
        self.groups.iter().any(|g| g.agents.iter().any(|a| a == token))
    }

    /// Evaluate `path` (path + query) for a crawler. `tokens` is the crawler's
    /// fallback chain, most specific first, e.g. `["googlebot-image", "googlebot", "*"]`.
    pub fn check(&self, tokens: &[&str], path: &str) -> Verdict {
        for token in tokens {
            let rules: Vec<&Rule> = self
                .groups
                .iter()
                .filter(|g| g.agents.iter().any(|a| a == token))
                .flat_map(|g| g.rules.iter())
                .collect();
            let has_group = self.has_group_for(token);
            if !has_group {
                continue;
            }
            let best = rules
                .iter()
                .filter(|r| pattern_matches(&r.pattern, path))
                .max_by(|a, b| specificity(&a.pattern).cmp(&specificity(&b.pattern)).then(a.allow.cmp(&b.allow)));
            return Verdict {
                allowed: best.map(|r| r.allow).unwrap_or(true),
                group: Some(token.to_string()),
                rule: best.map(|r| format!("{}: {}", if r.allow { "Allow" } else { "Disallow" }, r.pattern)),
            };
        }
        Verdict { allowed: true, group: None, rule: None }
    }
}

fn specificity(p: &str) -> usize {
    p.len()
}

/// Google-style match: pattern anchored at the start, `*` matches any
/// sequence, a trailing `$` anchors the end.
pub fn pattern_matches(pattern: &str, path: &str) -> bool {
    let (pat, anchored) = match pattern.strip_suffix('$') {
        Some(p) => (p, true),
        None => (pattern, false),
    };
    let p = pat.as_bytes();
    let s = path.as_bytes();
    // Iterative wildcard matching with backtracking on the last `*`.
    let (mut pi, mut si) = (0usize, 0usize);
    let mut star: Option<(usize, usize)> = None;
    loop {
        if pi == p.len() {
            if !anchored || si == s.len() {
                return true;
            }
        } else if p[pi] == b'*' {
            star = Some((pi, si));
            pi += 1;
            continue;
        } else if si < s.len() && p[pi] == s[si] {
            pi += 1;
            si += 1;
            continue;
        }
        match star {
            Some((sp, ss)) if ss < s.len() => {
                pi = sp + 1;
                si = ss + 1;
                star = Some((sp, ss + 1));
            }
            _ => return false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TXT: &str = "
User-agent: *
Disallow: /private
Allow: /private/public
Disallow: /*.pdf$

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: Googlebot
Disallow:

Sitemap: https://ex.com/sitemap.xml
Content-Signal: search=yes, ai-train=no
";

    #[test]
    fn groups_and_sitemaps() {
        let r = Robots::parse(TXT);
        assert_eq!(r.groups.len(), 3);
        assert_eq!(r.sitemaps, vec!["https://ex.com/sitemap.xml"]);
        assert_eq!(r.groups[1].agents, vec!["gptbot", "ccbot"]);
        assert_eq!(r.content_signals, vec!["search=yes, ai-train=no"]);
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    }

    #[test]
    fn matching() {
        let r = Robots::parse(TXT);
        assert!(!r.check(&["bingbot", "*"], "/private/x").allowed);
        assert!(r.check(&["bingbot", "*"], "/private/public/x").allowed);
        assert!(!r.check(&["bingbot", "*"], "/a/b.pdf").allowed);
        assert!(r.check(&["bingbot", "*"], "/a/b.pdf?x=1").allowed);
        assert!(!r.check(&["gptbot", "*"], "/").allowed);
        assert!(!r.check(&["ccbot", "*"], "/anything").allowed);
        // Googlebot has its own (empty) group, so the * rules don't apply.
        assert!(r.check(&["googlebot", "*"], "/private").allowed);
        assert!(r.check(&["claudebot", "*"], "/").allowed);
    }

    #[test]
    fn wildcards() {
        assert!(pattern_matches("/*/edit", "/post/1/edit"));
        assert!(pattern_matches("/", "/anything"));
        assert!(!pattern_matches("/a$", "/ab"));
        assert!(pattern_matches("*", ""));
        assert!(pattern_matches("/fish*", "/fish.html"));
        assert!(!pattern_matches("/fish", "/Fish"));
    }
}
