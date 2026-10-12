//! What JavaScript changes: the raw HTML (what AI crawlers and link-preview
//! bots read) compared with the browser-rendered DOM (what Google and people
//! see). Rendering is done outside the engine (Scrapling's DynamicFetcher).

use crate::extract::{extract, keyword_text, PageData};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use url::Url;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaChange {
    pub field: &'static str,
    pub raw: Option<String>,
    pub rendered: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderDiff {
    pub raw_words: usize,
    pub rendered_words: usize,
    /// Rendered words with no counterpart in the raw HTML.
    pub hidden_words: usize,
    /// Share of the rendered page's words that only exist after JavaScript runs (0-100).
    pub hidden_pct: u8,
    pub raw_internal_links: usize,
    pub rendered_internal_links: usize,
    pub links_only_rendered: Vec<String>,
    pub headings_only_rendered: Vec<String>,
    pub meta_changes: Vec<MetaChange>,
    pub jsonld_raw: Vec<String>,
    pub jsonld_rendered: Vec<String>,
    pub jsonld_only_rendered: Vec<String>,
    pub raw_images: usize,
    pub rendered_images: usize,
    /// A sample of text a non-rendering crawler never sees.
    pub hidden_sample: Option<String>,
    pub render_ms: Option<u32>,
    /// The browser left the page (meta refresh or JavaScript redirect). The
    /// rendered DOM is then a different page, so content isn't compared.
    pub redirected_to: Option<String>,
}

fn same_page(a: &str, b: &str) -> bool {
    let n = |u: &str| crate::sitemap::normalize(u.split('?').next().unwrap_or(u));
    n(a) == n(b)
}

/// Raw vs rendered, or a client-side-redirect report when the browser ended up elsewhere.
pub fn compare(
    raw: &PageData,
    raw_html: &str,
    rendered_html: &str,
    base: Option<&Url>,
    render_ms: Option<u32>,
    rendered_url: Option<&str>,
) -> RenderDiff {
    if let (Some(b), Some(r)) = (base, rendered_url) {
        if !same_page(b.as_str(), r) {
            return RenderDiff {
                raw_words: tokens(&keyword_text(raw_html)).len(),
                redirected_to: Some(r.to_string()),
                render_ms,
                ..Default::default()
            };
        }
    }
    diff(raw, raw_html, rendered_html, base, render_ms)
}

fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric()).filter(|w| w.chars().count() >= 2).map(|w| w.to_lowercase()).collect()
}

fn jsonld_types(p: &PageData) -> Vec<String> {
    let mut t: Vec<String> = p.json_ld.iter().flat_map(|b| b.types.clone()).collect();
    t.sort();
    t.dedup();
    t
}

fn norm(s: &Option<String>) -> Option<String> {
    s.as_ref().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

pub fn diff(
    raw: &PageData,
    raw_html: &str,
    rendered_html: &str,
    base: Option<&Url>,
    render_ms: Option<u32>,
) -> RenderDiff {
    let ren = extract(rendered_html, base);

    // Token multiset difference: each rendered token consumes one matching raw token.
    let raw_tokens = tokens(&keyword_text(raw_html));
    let ren_text = keyword_text(rendered_html);
    let ren_tokens = tokens(&ren_text);
    let mut pool: HashMap<&str, usize> = HashMap::new();
    for t in &raw_tokens {
        *pool.entry(t.as_str()).or_default() += 1;
    }
    let mut hidden = 0usize;
    for t in &ren_tokens {
        match pool.get_mut(t.as_str()) {
            Some(n) if *n > 0 => *n -= 1,
            _ => hidden += 1,
        }
    }
    let hidden_pct =
        if ren_tokens.is_empty() { 0 } else { ((hidden as f64 / ren_tokens.len() as f64) * 100.0).round() as u8 };

    // A rendered paragraph whose words are mostly absent from the raw HTML.
    let raw_set: HashSet<&str> = raw_tokens.iter().map(String::as_str).collect();
    let hidden_sample = ren_text
        .split('\n')
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| l.split_whitespace().count() >= 8)
        .find(|l| {
            let t = tokens(l);
            let missing = t.iter().filter(|w| !raw_set.contains(w.as_str())).count();
            !t.is_empty() && missing * 10 >= t.len() * 7
        })
        .map(|l| crate::extract::truncate_chars(&l, 240));

    let raw_links: HashSet<&str> = raw.links.iter().filter(|l| l.internal).map(|l| l.href.as_str()).collect();
    let mut links_only_rendered: Vec<String> = ren
        .links
        .iter()
        .filter(|l| l.internal && !raw_links.contains(l.href.as_str()))
        .map(|l| l.href.clone())
        .collect();
    links_only_rendered.sort();
    links_only_rendered.dedup();
    links_only_rendered.truncate(25);

    let raw_heads: HashSet<String> = raw.headings.iter().map(|h| h.text.to_lowercase()).collect();
    let mut headings_only_rendered: Vec<String> = ren
        .headings
        .iter()
        .filter(|h| !h.text.is_empty() && !raw_heads.contains(&h.text.to_lowercase()))
        .map(|h| format!("H{} {}", h.level, h.text))
        .collect();
    headings_only_rendered.dedup();
    headings_only_rendered.truncate(15);

    let mut meta_changes = Vec::new();
    let mut cmp = |field: &'static str, a: Option<String>, b: Option<String>| {
        if norm(&a) != norm(&b) {
            meta_changes.push(MetaChange { field, raw: norm(&a), rendered: norm(&b) });
        }
    };
    cmp("title", raw.title.clone(), ren.title.clone());
    cmp("description", raw.description.clone(), ren.description.clone());
    cmp("canonical", raw.canonicals.first().cloned(), ren.canonicals.first().cloned());
    cmp("robots", raw.meta_robots.clone(), ren.meta_robots.clone());
    cmp("og:title", raw.og("og:title").map(String::from), ren.og("og:title").map(String::from));
    cmp("og:description", raw.og("og:description").map(String::from), ren.og("og:description").map(String::from));
    cmp("og:image", raw.og("og:image").map(String::from), ren.og("og:image").map(String::from));
    cmp("lang", raw.lang.clone(), ren.lang.clone());

    let jsonld_raw = jsonld_types(raw);
    let jsonld_rendered = jsonld_types(&ren);
    let jsonld_only_rendered = jsonld_rendered.iter().filter(|t| !jsonld_raw.contains(t)).cloned().collect();

    RenderDiff {
        raw_words: raw_tokens.len(),
        rendered_words: ren_tokens.len(),
        hidden_words: hidden,
        hidden_pct,
        raw_internal_links: raw_links.len(),
        rendered_internal_links: ren.links.iter().filter(|l| l.internal).count(),
        links_only_rendered,
        headings_only_rendered,
        meta_changes,
        jsonld_raw,
        jsonld_rendered,
        jsonld_only_rendered,
        raw_images: raw.image_count,
        rendered_images: ren.image_count,
        hidden_sample,
        render_ms,
        redirected_to: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_js_only_content_meta_and_links() {
        let raw = r#"<html><head><title>Loading</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>"#;
        let rendered = r#"<html lang="en"><head><title>Acme pricing plans</title><meta name="description" content="Plans for teams">
            <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Acme"}</script></head>
            <body><div id="root"><h1>Pricing</h1><p>Choose the plan that fits your team and start a free trial today with no card required.</p>
            <a href="/signup">Sign up</a></div></body></html>"#;
        let base = Url::parse("https://acme.com/pricing").unwrap();
        let rp = extract(raw, Some(&base));
        let d = diff(&rp, raw, rendered, Some(&base), Some(800));
        assert!(d.hidden_pct >= 90, "{d:?}");
        assert!(d.meta_changes.iter().any(|m| m.field == "title"));
        assert!(d.meta_changes.iter().any(|m| m.field == "description" && m.raw.is_none()));
        assert_eq!(d.links_only_rendered, vec!["https://acme.com/signup"]);
        assert_eq!(d.jsonld_only_rendered, vec!["Product"]);
        assert!(d.headings_only_rendered.iter().any(|h| h == "H1 Pricing"));
        assert!(d.hidden_sample.unwrap().contains("Choose the plan"));
    }

    #[test]
    fn client_side_redirect_is_reported_not_compared() {
        let raw = r#"<html><head><meta http-equiv="refresh" content="0;url=https://acme.co.in/"><title>Redirecting</title></head><body>Redirecting</body></html>"#;
        let rendered = r#"<html><head><title>Acme India</title></head><body><h1>Welcome</h1><p>Lots of content here for the Indian site visitors to read.</p></body></html>"#;
        let base = Url::parse("https://acme.com/").unwrap();
        let rp = extract(raw, Some(&base));
        let d = compare(&rp, raw, rendered, Some(&base), Some(900), Some("https://acme.co.in/"));
        assert_eq!(d.redirected_to.as_deref(), Some("https://acme.co.in/"));
        assert_eq!(d.hidden_words, 0);
        assert!(d.meta_changes.is_empty());
    }

    #[test]
    fn server_rendered_page_has_nothing_hidden() {
        let html = r#"<html><head><title>Docs</title></head><body><h1>Docs</h1><p>Everything is rendered on the server so crawlers see it all.</p></body></html>"#;
        let rp = extract(html, None);
        let d = diff(&rp, html, html, None, None);
        assert_eq!(d.hidden_words, 0);
        assert!(d.meta_changes.is_empty());
    }
}
