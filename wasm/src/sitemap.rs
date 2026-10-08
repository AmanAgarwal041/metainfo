//! XML sitemap / sitemap index parsing (sitemaps.org protocol).

use crate::model::Resource;
use serde::Serialize;

const MAX_URLS: usize = 50_000;
const MAX_BYTES: usize = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitemapSource {
    pub url: String,
    pub status: Option<u16>,
    pub kind: &'static str,
    pub url_count: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitemapReport {
    pub found: bool,
    pub declared_in_robots: bool,
    pub sources: Vec<SitemapSource>,
    pub url_count: usize,
    pub lastmod_count: usize,
    pub latest_lastmod: Option<String>,
    pub child_sitemaps: Vec<String>,
    /// None when we couldn't see every child sitemap.
    pub contains_page: Option<bool>,
    /// A sitemap was larger than the download cap, so counts are lower bounds.
    pub partial: bool,
    pub sample_urls: Vec<String>,
    pub issues: Vec<String>,
}

fn decode(s: &str) -> String {
    s.trim()
        .trim_start_matches("<![CDATA[")
        .trim_end_matches("]]>")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .trim()
        .to_string()
}

/// Every `<tag>…</tag>` value inside `xml`.
fn tag_values<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find(&open) {
        let after = &rest[i + open.len()..];
        match after.find(&close) {
            Some(j) => {
                out.push(&after[..j]);
                rest = &after[j + close.len()..];
            }
            None => break,
        }
    }
    out
}

pub fn normalize(u: &str) -> String {
    let u = u.split('#').next().unwrap_or(u);
    let u = u.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.");
    u.trim_end_matches('/').to_ascii_lowercase()
}

pub fn analyze(resources: &[Resource], page_url: &str, robots_sitemaps: &[String]) -> SitemapReport {
    let mut r = SitemapReport { declared_in_robots: !robots_sitemaps.is_empty(), ..Default::default() };
    let target = normalize(page_url);
    let mut saw_page = false;
    let mut unfetched_children = false;

    for res in resources {
        let mut src = SitemapSource {
            url: res.url.clone(),
            status: res.status,
            kind: "missing",
            url_count: 0,
            error: res.error.clone(),
        };
        let Some(body) = res.ok_body() else {
            r.sources.push(src);
            continue;
        };
        if res.truncated {
            r.partial = true;
        }
        let head = body.trim_start();
        if head.starts_with("<!DOCTYPE html") || head.starts_with("<html") || head.starts_with("<!doctype html") {
            src.kind = "invalid";
            src.error = Some("Returned HTML instead of XML (soft 404?)".into());
            r.issues.push(format!("{} returns an HTML page, not a sitemap", res.url));
            r.sources.push(src);
            continue;
        }
        if body.len() > MAX_BYTES {
            r.issues.push(format!("{} is larger than 50 MB (uncompressed limit)", res.url));
        }
        if body.contains("<sitemapindex") {
            src.kind = "index";
            for loc in tag_values(body, "loc") {
                let loc = decode(loc);
                if !resources.iter().any(|x| x.url == loc) {
                    unfetched_children = true;
                }
                r.child_sitemaps.push(loc);
            }
            src.url_count = r.child_sitemaps.len();
        } else if body.contains("<urlset") {
            src.kind = "urlset";
            let locs = tag_values(body, "loc");
            src.url_count = locs.len();
            r.url_count += locs.len();
            if locs.len() > MAX_URLS {
                r.issues.push(format!("{} has {} URLs: the limit is 50,000 per file", res.url, locs.len()));
            }
            for loc in &locs {
                let loc = decode(loc);
                if !saw_page && normalize(&loc) == target {
                    saw_page = true;
                }
                if r.sample_urls.len() < 25 {
                    r.sample_urls.push(loc);
                }
            }
            for lm in tag_values(body, "lastmod") {
                r.lastmod_count += 1;
                let lm = decode(lm);
                if r.latest_lastmod.as_deref().map(|cur| lm.as_str() > cur).unwrap_or(true) {
                    r.latest_lastmod = Some(lm);
                }
            }
        } else {
            src.kind = "invalid";
            src.error = Some("No <urlset> or <sitemapindex> root element".into());
            r.issues.push(format!("{} is not a valid XML sitemap", res.url));
        }
        r.sources.push(src);
    }

    r.found = r.sources.iter().any(|s| s.kind == "urlset" || s.kind == "index");
    if r.found && r.url_count > 0 && r.lastmod_count == 0 {
        r.issues.push("No <lastmod> dates: search and AI engines use them to prioritise fresh content".into());
    }
    r.contains_page = if saw_page {
        Some(true)
    } else if !r.found || unfetched_children || r.partial {
        None
    } else {
        Some(false)
    };
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn res(url: &str, body: &str) -> Resource {
        Resource { url: url.into(), status: Some(200), body: Some(body.into()), ..Default::default() }
    }

    #[test]
    fn parses_urlset() {
        let xml = r#"<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://ex.com/</loc><lastmod>2024-01-01</lastmod></url>
            <url><loc>https://ex.com/a?x=1&amp;y=2</loc><lastmod>2025-02-01</lastmod></url></urlset>"#;
        let r = analyze(&[res("https://ex.com/sitemap.xml", xml)], "https://www.ex.com/a?x=1&y=2", &[]);
        assert!(r.found);
        assert_eq!(r.url_count, 2);
        assert_eq!(r.contains_page, Some(true));
        assert_eq!(r.latest_lastmod.as_deref(), Some("2025-02-01"));
    }

    #[test]
    fn truncated_sitemap_is_partial_and_inconclusive() {
        let xml = r#"<urlset><url><loc>https://ex.com/a</loc></url><url><loc>https://ex.com/b</loc>"#;
        let mut res = res("https://ex.com/sitemap.xml", xml);
        res.truncated = true;
        let r = analyze(&[res], "https://ex.com/zzz", &[]);
        assert!(r.found && r.partial);
        assert_eq!(r.url_count, 2);
        // Not in the part we read doesn't mean it's not in the sitemap.
        assert_eq!(r.contains_page, None);
    }

    #[test]
    fn index_with_unfetched_children_is_unknown() {
        let xml = r#"<sitemapindex><sitemap><loc>https://ex.com/s1.xml</loc></sitemap></sitemapindex>"#;
        let r = analyze(&[res("https://ex.com/sitemap.xml", xml)], "https://ex.com/a", &[]);
        assert_eq!(r.contains_page, None);
        assert_eq!(r.child_sitemaps.len(), 1);
    }
}
