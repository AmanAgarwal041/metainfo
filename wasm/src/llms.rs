//! /llms.txt (llmstxt.org): a markdown file with an H1 title, an optional
//! `>` summary, and H2 sections listing links for LLMs to read.

use crate::model::Resource;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmsReport {
    pub url: String,
    pub status: Option<u16>,
    pub found: bool,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub sections: Vec<String>,
    pub link_count: usize,
    pub bytes: usize,
    pub issues: Vec<String>,
    pub body: Option<String>,
}

pub fn analyze(res: &Resource) -> LlmsReport {
    let mut r = LlmsReport { url: res.url.clone(), status: res.status, ..Default::default() };
    let Some(body) = res.ok_body() else {
        return r;
    };
    let looks_html = body.trim_start().starts_with('<')
        || res.content_type.as_deref().map(|c| c.contains("text/html")).unwrap_or(false);
    if looks_html {
        r.issues.push("Server returns an HTML page at /llms.txt (likely a soft 404)".into());
        return r;
    }
    r.found = true;
    r.bytes = body.len();
    r.body = Some(body.chars().take(20_000).collect());

    for line in body.lines() {
        let t = line.trim();
        if let Some(h1) = t.strip_prefix("# ") {
            if r.title.is_none() {
                r.title = Some(h1.trim().to_string());
            }
        } else if let Some(h2) = t.strip_prefix("## ") {
            r.sections.push(h2.trim().to_string());
        } else if let Some(q) = t.strip_prefix('>') {
            if r.summary.is_none() && r.sections.is_empty() {
                r.summary = Some(q.trim().to_string());
            }
        }
        r.link_count += t.matches("](").count();
    }

    if r.title.is_none() {
        r.issues.push("Missing the required `# Title` H1 on the first line".into());
    }
    if r.summary.is_none() {
        r.issues.push("No `> summary` blockquote describing the site".into());
    }
    if r.link_count == 0 {
        r.issues.push("No markdown links to key pages — LLMs use these to find your best content".into());
    }
    r
}
