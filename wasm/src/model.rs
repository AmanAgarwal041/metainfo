//! Input bundle (assembled by the Next.js fetcher, or from pasted HTML) and
//! the report shape handed back to the UI. Everything crosses the WASM
//! boundary as JSON, so field names are camelCase.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ---------------------------------------------------------------- input

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScanInput {
    /// The URL the user asked for. For pasted HTML this may be a base URL or empty.
    pub url: String,
    pub final_url: Option<String>,
    pub status: Option<u16>,
    /// Response headers, keys lower-cased.
    pub headers: BTreeMap<String, String>,
    pub html: String,
    pub redirects: Vec<Redirect>,
    /// Time to first byte of the page fetch, in ms.
    pub ttfb_ms: Option<u32>,
    pub robots: Option<Resource>,
    pub sitemaps: Vec<Resource>,
    pub llms: Option<Resource>,
    /// Status codes returned when the page is requested with crawler user agents.
    pub bot_probes: Vec<BotProbe>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Redirect {
    pub url: String,
    pub status: u16,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Resource {
    pub url: String,
    pub status: Option<u16>,
    pub content_type: Option<String>,
    pub body: Option<String>,
    pub error: Option<String>,
}

impl Resource {
    pub fn ok_body(&self) -> Option<&str> {
        match (self.status, &self.body) {
            (Some(s), Some(b)) if (200..300).contains(&s) => Some(b.as_str()),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BotProbe {
    pub bot: String,
    pub status: Option<u16>,
    pub error: Option<String>,
}

// ---------------------------------------------------------------- output

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Google,
    Bing,
    ChatGPT,
    Perplexity,
    Claude,
    Gemini,
    Social,
}

impl Platform {
    pub const ALL: [Platform; 7] = [
        Platform::Google,
        Platform::Bing,
        Platform::ChatGPT,
        Platform::Perplexity,
        Platform::Claude,
        Platform::Gemini,
        Platform::Social,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Platform::Google => "Google",
            Platform::Bing => "Bing",
            Platform::ChatGPT => "ChatGPT",
            Platform::Perplexity => "Perplexity",
            Platform::Claude => "Claude",
            Platform::Gemini => "Gemini / AI Overviews",
            Platform::Social => "Social sharing",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Indexability,
    Meta,
    Social,
    Content,
    Structured,
    Ai,
    Performance,
}

impl Category {
    pub const ALL: [Category; 7] = [
        Category::Indexability,
        Category::Meta,
        Category::Social,
        Category::Content,
        Category::Structured,
        Category::Ai,
        Category::Performance,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Category::Indexability => "Crawling & indexing",
            Category::Meta => "Meta tags",
            Category::Social => "Social & Open Graph",
            Category::Content => "Content & headings",
            Category::Structured => "Structured data",
            Category::Ai => "AI readiness",
            Category::Performance => "Performance & security",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Pass,
    Warn,
    Fail,
    /// Not applicable / informational. Excluded from scoring.
    Info,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
}

impl Severity {
    pub fn weight(self) -> f64 {
        match self {
            Severity::Critical => 10.0,
            Severity::High => 6.0,
            Severity::Medium => 3.0,
            Severity::Low => 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: &'static str,
    pub category: Category,
    pub title: &'static str,
    pub status: Status,
    pub severity: Severity,
    pub effort: Effort,
    pub platforms: Vec<Platform>,
    /// What we found on the page.
    pub finding: String,
    /// Why this matters (rule source / ranking rationale).
    pub why: &'static str,
    /// What to do about it.
    pub recommendation: String,
    /// Copy-pasteable fix, when we can generate one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet_lang: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformScore {
    pub platform: Platform,
    pub label: &'static str,
    pub score: u8,
    pub passed: usize,
    pub failed: usize,
    pub warnings: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryScore {
    pub category: Category,
    pub label: &'static str,
    pub score: u8,
    pub passed: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTask {
    pub check_id: &'static str,
    pub title: String,
    pub category: Category,
    pub severity: Severity,
    pub effort: Effort,
    pub platforms: Vec<Platform>,
    pub recommendation: String,
    /// Estimated score points gained per platform if this task is completed.
    pub gains: BTreeMap<Platform, f64>,
    pub total_gain: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanPhase {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub tasks: Vec<PlanTask>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Generated {
    pub head_html: String,
    pub json_ld: String,
    pub robots_txt: String,
    pub llms_txt: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub overall: u8,
    pub critical: usize,
    pub failed: usize,
    pub warnings: usize,
    pub passed: usize,
    pub total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub engine_version: &'static str,
    pub url: String,
    pub final_url: String,
    pub status: Option<u16>,
    pub redirects: Vec<Redirect>,
    pub ttfb_ms: Option<u32>,
    pub summary: Summary,
    pub scores: Vec<PlatformScore>,
    pub categories: Vec<CategoryScore>,
    pub checks: Vec<Check>,
    pub plan: Vec<PlanPhase>,
    pub page: crate::extract::PageData,
    pub robots: Option<crate::robots::RobotsReport>,
    pub sitemap: Option<crate::sitemap::SitemapReport>,
    pub llms: Option<crate::llms::LlmsReport>,
    pub crawlers: Vec<crate::crawlers::CrawlerAccess>,
    pub generated: Generated,
}
