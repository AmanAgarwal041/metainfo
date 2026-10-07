//! The crawlers each search / answer engine relies on, and whether each one
//! can reach the page (robots.txt rules + what the server returned when we
//! requested the page with that crawler's user agent).

use crate::model::{BotProbe, Platform};
use crate::robots::Robots;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    /// Builds the search index answers are grounded on.
    Search,
    /// Fetches pages live when a user asks about them.
    User,
    /// Collects training data. Blocking it doesn't remove you from answers.
    Training,
}

pub struct Bot {
    pub id: &'static str,
    pub name: &'static str,
    pub operator: &'static str,
    pub purpose: Purpose,
    pub platform: Option<Platform>,
    /// robots.txt tokens, most specific first.
    pub tokens: &'static [&'static str],
}

pub const BOTS: &[Bot] = &[
    Bot {
        id: "googlebot",
        name: "Googlebot",
        operator: "Google",
        purpose: Purpose::Search,
        platform: Some(Platform::Google),
        tokens: &["googlebot", "*"],
    },
    Bot {
        id: "google-extended",
        name: "Google-Extended",
        operator: "Google",
        purpose: Purpose::Training,
        platform: Some(Platform::Gemini),
        tokens: &["google-extended", "*"],
    },
    Bot {
        id: "bingbot",
        name: "Bingbot",
        operator: "Microsoft",
        purpose: Purpose::Search,
        platform: Some(Platform::Bing),
        tokens: &["bingbot", "msnbot", "*"],
    },
    Bot {
        id: "oai-searchbot",
        name: "OAI-SearchBot",
        operator: "OpenAI",
        purpose: Purpose::Search,
        platform: Some(Platform::ChatGPT),
        tokens: &["oai-searchbot", "*"],
    },
    Bot {
        id: "chatgpt-user",
        name: "ChatGPT-User",
        operator: "OpenAI",
        purpose: Purpose::User,
        platform: Some(Platform::ChatGPT),
        tokens: &["chatgpt-user", "*"],
    },
    Bot {
        id: "gptbot",
        name: "GPTBot",
        operator: "OpenAI",
        purpose: Purpose::Training,
        platform: Some(Platform::ChatGPT),
        tokens: &["gptbot", "*"],
    },
    Bot {
        id: "claude-searchbot",
        name: "Claude-SearchBot",
        operator: "Anthropic",
        purpose: Purpose::Search,
        platform: Some(Platform::Claude),
        tokens: &["claude-searchbot", "*"],
    },
    Bot {
        id: "claude-user",
        name: "Claude-User",
        operator: "Anthropic",
        purpose: Purpose::User,
        platform: Some(Platform::Claude),
        tokens: &["claude-user", "*"],
    },
    Bot {
        id: "claudebot",
        name: "ClaudeBot",
        operator: "Anthropic",
        purpose: Purpose::Training,
        platform: Some(Platform::Claude),
        tokens: &["claudebot", "anthropic-ai", "*"],
    },
    Bot {
        id: "perplexitybot",
        name: "PerplexityBot",
        operator: "Perplexity",
        purpose: Purpose::Search,
        platform: Some(Platform::Perplexity),
        tokens: &["perplexitybot", "*"],
    },
    Bot {
        id: "perplexity-user",
        name: "Perplexity-User",
        operator: "Perplexity",
        purpose: Purpose::User,
        platform: Some(Platform::Perplexity),
        tokens: &["perplexity-user", "*"],
    },
    Bot {
        id: "applebot-extended",
        name: "Applebot-Extended",
        operator: "Apple",
        purpose: Purpose::Training,
        platform: None,
        tokens: &["applebot-extended", "*"],
    },
    Bot {
        id: "ccbot",
        name: "CCBot",
        operator: "Common Crawl",
        purpose: Purpose::Training,
        platform: None,
        tokens: &["ccbot", "*"],
    },
    Bot {
        id: "meta-externalagent",
        name: "Meta-ExternalAgent",
        operator: "Meta",
        purpose: Purpose::Training,
        platform: None,
        tokens: &["meta-externalagent", "*"],
    },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlerAccess {
    pub id: &'static str,
    pub name: &'static str,
    pub operator: &'static str,
    pub purpose: Purpose,
    pub platform: Option<Platform>,
    /// None when there's no robots.txt to evaluate.
    pub robots_allowed: Option<bool>,
    pub robots_group: Option<String>,
    pub robots_rule: Option<String>,
    /// Status returned when we requested the page with this crawler's UA.
    pub edge_status: Option<u16>,
    pub edge_error: Option<String>,
    /// The server also rejected our Googlebot/Bingbot probe, so it verifies
    /// crawlers by IP and UA-only probes say nothing about the real bots.
    pub edge_inconclusive: bool,
    pub allowed: bool,
}

impl CrawlerAccess {
    pub fn edge_blocked(&self) -> bool {
        matches!(self.edge_status, Some(s) if s == 401 || s == 403 || s == 429 || s >= 500)
    }
}

pub fn evaluate(robots: Option<&Robots>, path: &str, probes: &[BotProbe]) -> Vec<CrawlerAccess> {
    let spoof_rejected = probes.iter().any(|p| {
        (p.bot == "googlebot" || p.bot == "bingbot")
            && matches!(p.status, Some(s) if s == 401 || s == 403 || s == 429 || s >= 500)
    });
    BOTS.iter()
        .map(|b| {
            let verdict = robots.map(|r| r.check(b.tokens, path));
            let probe = probes.iter().find(|p| p.bot == b.id);
            let mut c = CrawlerAccess {
                id: b.id,
                name: b.name,
                operator: b.operator,
                purpose: b.purpose,
                platform: b.platform,
                robots_allowed: verdict.as_ref().map(|v| v.allowed),
                robots_group: verdict.as_ref().and_then(|v| v.group.clone()),
                robots_rule: verdict.and_then(|v| v.rule),
                edge_status: probe.and_then(|p| p.status),
                edge_error: probe.and_then(|p| p.error.clone()),
                edge_inconclusive: false,
                allowed: true,
            };
            c.edge_inconclusive = spoof_rejected && c.edge_blocked();
            c.allowed = c.robots_allowed.unwrap_or(true) && (!c.edge_blocked() || c.edge_inconclusive);
            c
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(bot: &str, status: u16) -> BotProbe {
        BotProbe { bot: bot.into(), status: Some(status), error: None }
    }

    #[test]
    fn edge_block_counts_when_googlebot_gets_through() {
        let r = evaluate(None, "/", &[probe("googlebot", 200), probe("gptbot", 403)]);
        let gpt = r.iter().find(|c| c.id == "gptbot").unwrap();
        assert!(!gpt.allowed && !gpt.edge_inconclusive);
    }

    #[test]
    fn edge_block_is_inconclusive_when_spoofed_googlebot_is_rejected() {
        let r = evaluate(None, "/", &[probe("googlebot", 403), probe("gptbot", 403)]);
        assert!(r.iter().filter(|c| c.edge_status.is_some()).all(|c| c.allowed && c.edge_inconclusive));
    }
}
