//! MetaInfo scan engine. The host (browser or Node) fetches the page and its
//! companion files, then hands a JSON bundle to [`analyze`]; everything else —
//! parsing, rules, scoring, the fix plan and generated files — happens here.

use wasm_bindgen::prelude::*;

pub mod checks;
pub mod crawlers;
pub mod extract;
pub mod generate;
pub mod keywords;
pub mod llms;
pub mod model;
pub mod robots;
pub mod scoring;
pub mod sitemap;

use model::{Report, ScanInput};
use url::Url;

pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Analyse a scan bundle (JSON, see [`ScanInput`]) and return the report as JSON.
/// Errors are returned as `{"error": "..."}` rather than thrown.
#[wasm_bindgen]
pub fn analyze(input_json: &str) -> String {
    match serde_json::from_str::<ScanInput>(input_json) {
        Ok(input) => serde_json::to_string(&analyze_input(&input))
            .unwrap_or_else(|e| serde_json::json!({ "error": e.to_string() }).to_string()),
        Err(e) => serde_json::json!({ "error": format!("Invalid scan input: {e}") }).to_string(),
    }
}

/// Count how often each term in `terms_json` (a JSON string array) appears in
/// the page's main text. Returns a JSON number array in the same order.
#[wasm_bindgen]
pub fn term_counts(html: &str, terms_json: &str) -> String {
    let terms: Vec<String> = serde_json::from_str(terms_json).unwrap_or_default();
    serde_json::to_string(&extract::term_counts(html, &terms)).unwrap_or_else(|_| "[]".into())
}

#[wasm_bindgen]
pub fn engine_version() -> String {
    ENGINE_VERSION.to_string()
}

pub fn analyze_input(input: &ScanInput) -> Report {
    let html_only = input.status.is_none();
    let requested = input.final_url.as_deref().unwrap_or(&input.url);
    let mut url = Url::parse(requested.trim()).ok().filter(|u| u.scheme().starts_with("http"));

    let mut page = extract::extract(&input.html, url.as_ref());
    // Pasted HTML without a URL: fall back to the page's own canonical / og:url.
    if url.is_none() {
        let own = page
            .canonicals
            .iter()
            .map(String::as_str)
            .chain(page.og("og:url"))
            .find_map(|c| Url::parse(c).ok().filter(|u| u.scheme().starts_with("http")));
        if let Some(own) = own {
            page = extract::extract(&input.html, Some(&own));
            url = Some(own);
        }
    }

    let path = url
        .as_ref()
        .map(|u| match u.query() {
            Some(q) => format!("{}?{}", u.path(), q),
            None => u.path().to_string(),
        })
        .unwrap_or_else(|| "/".into());

    let robots_parsed = input.robots.as_ref().and_then(|r| r.ok_body()).map(robots::Robots::parse);
    let robots_report = input.robots.as_ref().map(|r| {
        let parsed = robots_parsed.clone().unwrap_or_default();
        robots::RobotsReport {
            url: r.url.clone(),
            status: r.status,
            found: r.ok_body().is_some(),
            agents: parsed.agents(),
            sitemaps: parsed.sitemaps.clone(),
            warnings: parsed.warnings.clone(),
            content_signals: parsed.content_signals.clone(),
            bytes: r.body.as_ref().map(|b| b.len()).unwrap_or(0),
            body: r.ok_body().map(|b| b.chars().take(50_000).collect()),
        }
    });
    let robots_sitemaps = robots_parsed.as_ref().map(|r| r.sitemaps.clone()).unwrap_or_default();

    let sitemap_report = if input.sitemaps.is_empty() {
        None
    } else {
        Some(sitemap::analyze(&input.sitemaps, url.as_ref().map(Url::as_str).unwrap_or(""), &robots_sitemaps))
    };
    let llms_report = input.llms.as_ref().map(llms::analyze);
    let crawlers = if html_only {
        vec![]
    } else {
        // A missing robots.txt (404) means "allow all" — evaluate against an empty file.
        let rb = robots_parsed.clone().or_else(|| input.robots.as_ref().map(|_| robots::Robots::default()));
        crawlers::evaluate(rb.as_ref(), &path, &input.bot_probes)
    };

    let sugg = generate::Suggestions::new(&page, url.as_ref());
    let checks = checks::run(&checks::Ctx {
        input,
        page: &page,
        url: url.as_ref(),
        robots: robots_report.as_ref(),
        sitemap: sitemap_report.as_ref(),
        llms: llms_report.as_ref(),
        crawlers: &crawlers,
        sugg: &sugg,
        html_only,
    });

    let scores = scoring::platform_scores(&checks);
    let categories = scoring::category_scores(&checks);
    let summary = scoring::summary(&checks);
    let plan = scoring::plan(&checks);
    let sitemaps_for_gen: Vec<String> = if robots_sitemaps.is_empty() {
        sitemap_report
            .as_ref()
            .filter(|s| s.found)
            .map(|s| s.sources.iter().filter(|x| x.kind != "missing").map(|x| x.url.clone()).take(1).collect())
            .unwrap_or_default()
    } else {
        robots_sitemaps.clone()
    };
    let generated = generate::all(&page, &sugg, robots_parsed.as_ref(), &sitemaps_for_gen, &path);

    Report {
        engine_version: ENGINE_VERSION,
        url: input.url.clone(),
        final_url: url.map(|u| u.to_string()).unwrap_or_default(),
        status: input.status,
        redirects: input.redirects.clone(),
        ttfb_ms: input.ttfb_ms,
        summary,
        scores,
        categories,
        checks,
        plan,
        page,
        robots: robots_report,
        sitemap: sitemap_report,
        llms: llms_report,
        crawlers,
        generated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn end_to_end_bundle() {
        let input = serde_json::json!({
            "url": "https://ex.com/blog/post",
            "finalUrl": "https://ex.com/blog/post",
            "status": 200,
            "headers": {"content-type": "text/html; charset=utf-8", "content-encoding": "br"},
            "html": "<html lang=en><head><title>Short</title></head><body><h1>Post</h1><p>Hello world this is a fairly long paragraph with more than twelve words in it.</p></body></html>",
            "ttfbMs": 120,
            "robots": {"url": "https://ex.com/robots.txt", "status": 200, "body": "User-agent: GPTBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /blog/\n"},
            "sitemaps": [{"url": "https://ex.com/sitemap.xml", "status": 404}],
            "llms": {"url": "https://ex.com/llms.txt", "status": 404},
            "botProbes": [{"bot": "claudebot", "status": 403}]
        });
        let out = analyze(&input.to_string());
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v.get("error").is_none(), "{out}");
        let check = |id: &str| v["checks"].as_array().unwrap().iter().find(|c| c["id"] == id).cloned().unwrap();
        assert_eq!(check("access-perplexity")["status"], "fail");
        assert_eq!(check("access-chatgpt")["status"], "pass"); // only GPTBot (training) blocked
        assert_eq!(check("title-length")["status"], "warn");
        assert_eq!(check("description")["status"], "fail");
        assert_eq!(check("sitemap")["status"], "fail");
        assert!(v["generated"]["robotsTxt"].as_str().unwrap().contains("User-agent: PerplexityBot"));
        assert!(v["plan"][0]["tasks"].as_array().unwrap().iter().any(|t| t["checkId"] == "access-perplexity"));
        let pplx = v["scores"].as_array().unwrap().iter().find(|s| s["platform"] == "perplexity").unwrap();
        assert!(pplx["score"].as_u64().unwrap() < 70);
    }

    #[test]
    fn pasted_html_uses_own_canonical() {
        let input = serde_json::json!({
            "url": "",
            "html": "<html><head><link rel=canonical href='https://ex.com/a'></head><body></body></html>"
        });
        let v: serde_json::Value = serde_json::from_str(&analyze(&input.to_string())).unwrap();
        assert_eq!(v["finalUrl"], "https://ex.com/a");
        assert!(v["crawlers"].as_array().unwrap().is_empty());
    }
}
