//! Suggested values and ready-to-paste files, derived from what the page
//! already has so the output is specific to the site rather than boilerplate.

use crate::crawlers::{Purpose, BOTS};
use crate::extract::{ld_types, truncate_chars, PageData};
use crate::model::Generated;
use crate::robots::Robots;
use serde_json::{json, Map, Value};
use url::Url;

pub const TITLE_MIN: usize = 30;
pub const TITLE_MAX: usize = 60;
pub const DESC_MIN: usize = 70;
pub const DESC_MAX: usize = 160;

const SOCIAL_HOSTS: [&str; 10] = [
    "twitter.com",
    "x.com",
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "youtube.com",
    "github.com",
    "tiktok.com",
    "threads.net",
    "wikipedia.org",
];

pub struct Suggestions {
    pub site_name: String,
    pub title: String,
    pub description: String,
    pub canonical: Option<String>,
    pub origin: Option<String>,
    pub image: Option<String>,
    pub logo: Option<String>,
    pub locale: String,
    pub is_article: bool,
    pub same_as: Vec<String>,
}

pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

fn len(s: &str) -> usize {
    s.chars().count()
}

impl Suggestions {
    pub fn new(p: &PageData, url: Option<&Url>) -> Suggestions {
        let entities = p.ld_entities();
        let ld_name = entities
            .iter()
            .find(|e| ld_types(e).iter().any(|t| t == "Organization" || t == "WebSite"))
            .and_then(|e| e.get("name"))
            .and_then(Value::as_str)
            .map(String::from);
        let host_name = url.and_then(|u| u.host_str()).map(|h| {
            let label = h.trim_start_matches("www.").split('.').next().unwrap_or(h);
            let mut c = label.chars();
            c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
        });
        let site_name =
            p.og("og:site_name").map(String::from).or(ld_name).or(host_name).unwrap_or_else(|| "Your Site".into());

        let h1 = p.h1s().map(|h| h.text.clone()).find(|t| !t.is_empty());
        let title = match &p.title {
            Some(t) if (TITLE_MIN..=TITLE_MAX).contains(&len(t)) => t.clone(),
            Some(t) if len(t) > TITLE_MAX => truncate_chars(t, TITLE_MAX - 1),
            other => {
                let base = other
                    .clone()
                    .or_else(|| p.og("og:title").map(String::from))
                    .or(h1)
                    .unwrap_or_else(|| site_name.clone());
                let combined = if base.contains(&site_name) { base } else { format!("{base} | {site_name}") };
                truncate_chars(&combined, TITLE_MAX - 1)
            }
        };

        let description = match &p.description {
            Some(d) if (DESC_MIN..=DESC_MAX).contains(&len(d)) => d.clone(),
            _ => {
                let src = p
                    .description
                    .clone()
                    .filter(|d| len(d) > DESC_MAX)
                    .or_else(|| p.og("og:description").map(String::from))
                    .or_else(|| p.first_paragraph.clone())
                    .unwrap_or_else(|| p.excerpt.clone());
                if src.is_empty() {
                    format!("Learn about {site_name}: what we do, who it's for, and how to get started.")
                } else {
                    truncate_chars(&src, 155)
                }
            }
        };

        let canonical = url.map(|u| {
            let mut c = u.clone();
            c.set_fragment(None);
            c.to_string()
        });
        let origin = url.map(|u| u.origin().ascii_serialization()).filter(|o| o != "null");
        let image = p.og("og:image").or_else(|| p.tw("twitter:image")).map(String::from).or_else(|| {
            p.images.iter().find(|i| !i.src.is_empty() && !i.src.starts_with("data:")).map(|i| i.src.clone())
        });
        let logo = p
            .icons
            .iter()
            .find(|i| i.rel.contains("apple-touch-icon"))
            .or_else(|| p.icons.first())
            .map(|i| crate::extract::resolve(url, &i.href));
        let locale = p
            .lang
            .as_deref()
            .map(|l| l.replace('-', "_"))
            .map(|l| {
                if l.contains('_') {
                    l
                } else if l == "en" {
                    "en_US".into()
                } else {
                    format!("{l}_{}", l.to_uppercase())
                }
            })
            .unwrap_or_else(|| "en_US".into());
        let is_article = p.og("og:type") == Some("article")
            || entities.iter().any(|e| ld_types(e).iter().any(|t| t.ends_with("Article") || t == "BlogPosting"));
        let mut same_as: Vec<String> = p
            .links
            .iter()
            .filter(|l| !l.internal)
            .filter(|l| {
                Url::parse(&l.href)
                    .ok()
                    .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()))
                    .map(|h| SOCIAL_HOSTS.iter().any(|s| h == *s || h.ends_with(&format!(".{s}"))))
                    .unwrap_or(false)
            })
            .map(|l| l.href.clone())
            .collect();
        same_as.sort();
        same_as.dedup();
        same_as.truncate(8);

        Suggestions { site_name, title, description, canonical, origin, image, logo, locale, is_article, same_as }
    }
}

pub fn head_html(p: &PageData, s: &Suggestions) -> String {
    let mut o = String::new();
    let mut line = |l: String| {
        o.push_str(&l);
        o.push('\n');
    };
    line(r#"<meta charset="utf-8">"#.into());
    line(r#"<meta name="viewport" content="width=device-width, initial-scale=1">"#.into());
    line(format!("<title>{}</title>", esc(&s.title)));
    line(format!(r#"<meta name="description" content="{}">"#, esc(&s.description)));
    if let Some(c) = &s.canonical {
        line(format!(r#"<link rel="canonical" href="{}">"#, esc(c)));
    }
    line(r#"<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">"#.into());
    if p.icons.is_empty() {
        line(r#"<link rel="icon" href="/favicon.ico" sizes="any">"#.into());
        line(r#"<link rel="apple-touch-icon" href="/apple-touch-icon.png">"#.into());
    }
    if let Some(a) = &p.author {
        line(format!(r#"<meta name="author" content="{}">"#, esc(a)));
    }
    line(String::new());
    line("<!-- Open Graph: Facebook, LinkedIn, Slack, iMessage, ChatGPT & Perplexity link cards -->".into());
    line(format!(r#"<meta property="og:type" content="{}">"#, if s.is_article { "article" } else { "website" }));
    line(format!(r#"<meta property="og:site_name" content="{}">"#, esc(&s.site_name)));
    line(format!(r#"<meta property="og:title" content="{}">"#, esc(p.og("og:title").unwrap_or(&s.title))));
    line(format!(
        r#"<meta property="og:description" content="{}">"#,
        esc(p.og("og:description").unwrap_or(&s.description))
    ));
    if let Some(c) = &s.canonical {
        line(format!(r#"<meta property="og:url" content="{}">"#, esc(c)));
    }
    let img = s.image.clone().unwrap_or_else(|| format!("{}/og-image.png", s.origin.clone().unwrap_or_default()));
    line(format!(r#"<meta property="og:image" content="{}">"#, esc(&img)));
    line(r#"<meta property="og:image:width" content="1200">"#.into());
    line(r#"<meta property="og:image:height" content="630">"#.into());
    line(format!(r#"<meta property="og:image:alt" content="{}">"#, esc(&s.title)));
    line(format!(r#"<meta property="og:locale" content="{}">"#, esc(&s.locale)));
    if s.is_article {
        if let Some(d) = &p.published {
            line(format!(r#"<meta property="article:published_time" content="{}">"#, esc(d)));
        }
        line(format!(
            r#"<meta property="article:modified_time" content="{}">"#,
            esc(p.modified.as_deref().unwrap_or("YYYY-MM-DDThh:mm:ssZ"))
        ));
    }
    line(String::new());
    line("<!-- X / Twitter -->".into());
    line(r#"<meta name="twitter:card" content="summary_large_image">"#.into());
    line(format!(r#"<meta name="twitter:title" content="{}">"#, esc(p.tw("twitter:title").unwrap_or(&s.title))));
    line(format!(
        r#"<meta name="twitter:description" content="{}">"#,
        esc(p.tw("twitter:description").unwrap_or(&s.description))
    ));
    line(format!(r#"<meta name="twitter:image" content="{}">"#, esc(&img)));
    o.trim_end().to_string()
}

pub fn json_ld(p: &PageData, s: &Suggestions) -> String {
    let origin = s.origin.clone().unwrap_or_else(|| "https://example.com".into());
    let org_id = format!("{origin}/#organization");
    let mut org = Map::new();
    org.insert("@type".into(), json!("Organization"));
    org.insert("@id".into(), json!(org_id));
    org.insert("name".into(), json!(s.site_name));
    org.insert("url".into(), json!(format!("{origin}/")));
    org.insert("logo".into(), json!(s.logo.clone().unwrap_or_else(|| format!("{origin}/logo.png"))));
    org.insert(
        "sameAs".into(),
        if s.same_as.is_empty() {
            json!(["https://www.linkedin.com/company/your-company", "https://x.com/your-handle"])
        } else {
            json!(s.same_as)
        },
    );

    let website = json!({
        "@type": "WebSite",
        "@id": format!("{origin}/#website"),
        "url": format!("{origin}/"),
        "name": s.site_name,
        "publisher": { "@id": org_id },
        "inLanguage": p.lang.clone().unwrap_or_else(|| "en".into()),
    });

    let page_url = s.canonical.clone().unwrap_or_else(|| format!("{origin}/"));
    let page = if s.is_article {
        json!({
            "@type": "Article",
            "@id": format!("{page_url}#article"),
            "mainEntityOfPage": page_url,
            "headline": truncate_chars(p.og("og:title").unwrap_or(&s.title), 110),
            "description": s.description,
            "image": s.image.clone().map(|i| json!([i])).unwrap_or(json!([])),
            "author": { "@type": "Person", "name": p.author.clone().unwrap_or_else(|| "Author Name".into()) },
            "publisher": { "@id": org_id },
            "datePublished": p.published.clone().unwrap_or_else(|| "YYYY-MM-DD".into()),
            "dateModified": p.modified.clone().or_else(|| p.published.clone()).unwrap_or_else(|| "YYYY-MM-DD".into()),
        })
    } else {
        let mut wp = json!({
            "@type": "WebPage",
            "@id": format!("{page_url}#webpage"),
            "url": page_url,
            "name": s.title,
            "description": s.description,
            "isPartOf": { "@id": format!("{origin}/#website") },
            "about": { "@id": org_id },
        });
        if let Some(m) = p.modified.clone().or_else(|| p.published.clone()) {
            wp["dateModified"] = json!(m);
        }
        wp
    };

    let mut graph = vec![Value::Object(org), website, page];

    if let Ok(u) = Url::parse(&page_url) {
        let segs: Vec<&str> = u.path_segments().map(|s| s.filter(|x| !x.is_empty()).collect()).unwrap_or_default();
        if !segs.is_empty() {
            let mut items = vec![json!({"@type":"ListItem","position":1,"name":"Home","item":format!("{origin}/")})];
            let mut path = String::new();
            for (i, seg) in segs.iter().enumerate() {
                path.push('/');
                path.push_str(seg);
                let name = if i == segs.len() - 1 {
                    p.h1s().next().map(|h| h.text.clone()).unwrap_or_else(|| humanize(seg))
                } else {
                    humanize(seg)
                };
                items.push(json!({"@type":"ListItem","position":i+2,"name":name,"item":format!("{origin}{path}")}));
            }
            graph.push(json!({"@type":"BreadcrumbList","itemListElement":items}));
        }
    }

    let doc = json!({ "@context": "https://schema.org", "@graph": graph });
    format!(
        "<script type=\"application/ld+json\">\n{}\n</script>",
        serde_json::to_string_pretty(&doc).unwrap_or_default()
    )
}

fn humanize(seg: &str) -> String {
    let s = seg.replace(['-', '_'], " ");
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

/// A robots.txt that explicitly welcomes search + AI answer engines while
/// keeping the site's existing `User-agent: *` rules and training-bot choices.
pub fn robots_txt(robots: Option<&Robots>, s: &Suggestions, sitemaps: &[String], path: &str) -> String {
    let star_rules: Vec<String> = robots
        .map(|r| {
            r.groups
                .iter()
                .filter(|g| g.agents.iter().any(|a| a == "*"))
                .flat_map(|g| g.rules.iter())
                .filter(|rule| rule.allow || rule.pattern != "/")
                .map(|rule| format!("{}: {}", if rule.allow { "Allow" } else { "Disallow" }, rule.pattern))
                .collect()
        })
        .unwrap_or_default();
    let mut o = String::new();
    o.push_str("# Generated by MetaInfo: review before deploying.\n\n");
    o.push_str("# Search engines and AI answer engines (keep these open to be cited)\n");
    for b in BOTS.iter().filter(|b| b.purpose != Purpose::Training) {
        o.push_str(&format!("User-agent: {}\n", b.name));
    }
    for r in &star_rules {
        o.push_str(r);
        o.push('\n');
    }
    o.push_str("Allow: /\n\n");

    o.push_str("# AI training crawlers: opting out does NOT remove you from AI answers.\n");
    o.push_str("# Current choice preserved; switch to `Allow: /` to be included in future model knowledge.\n");
    for b in BOTS.iter().filter(|b| b.purpose == Purpose::Training) {
        o.push_str(&format!("User-agent: {}\n", b.name));
    }
    let training_blocked = robots
        .map(|r| BOTS.iter().filter(|b| b.purpose == Purpose::Training).any(|b| !r.check(b.tokens, path).allowed))
        .unwrap_or(false);
    if training_blocked {
        o.push_str("Disallow: /\n\n");
    } else {
        for r in &star_rules {
            o.push_str(r);
            o.push('\n');
        }
        o.push_str("Allow: /\n\n");
    }

    o.push_str("# Everyone else\nUser-agent: *\n");
    for r in &star_rules {
        o.push_str(r);
        o.push('\n');
    }
    o.push_str("Allow: /\n\n");

    let mut maps: Vec<String> = sitemaps.to_vec();
    if maps.is_empty() {
        if let Some(origin) = &s.origin {
            maps.push(format!("{origin}/sitemap.xml"));
        }
    }
    for m in maps {
        o.push_str(&format!("Sitemap: {m}\n"));
    }
    o.trim_end().to_string() + "\n"
}

pub fn llms_txt(p: &PageData, s: &Suggestions, sitemap: Option<&str>) -> String {
    let mut o = format!("# {}\n\n> {}\n\n", s.site_name, s.description);
    if let Some(fp) = &p.first_paragraph {
        if fp != &s.description {
            o.push_str(&truncate_chars(fp, 400));
            o.push_str("\n\n");
        }
    }
    o.push_str("## Key pages\n\n");
    let mut seen = Vec::<String>::new();
    for l in p.links.iter().filter(|l| l.internal) {
        let text = l.text.trim();
        let wc = text.split_whitespace().count();
        let href = l.href.split('#').next().unwrap_or(&l.href).to_string();
        if text.is_empty() || wc > 8 || seen.contains(&href) || Some(&href) == s.canonical.as_ref() {
            continue;
        }
        seen.push(href.clone());
        o.push_str(&format!("- [{}]({})\n", text, href));
        if seen.len() >= 15 {
            break;
        }
    }
    if seen.is_empty() {
        let origin = s.origin.clone().unwrap_or_default();
        o.push_str(&format!("- [Home]({origin}/): What {} does\n", s.site_name));
        o.push_str(&format!("- [Docs]({origin}/docs): Product documentation\n"));
        o.push_str(&format!("- [Pricing]({origin}/pricing): Plans and pricing\n"));
    }
    o.push_str("\n## Optional\n\n");
    if let Some(sm) = sitemap {
        o.push_str(&format!("- [Sitemap]({sm}): Full list of pages\n"));
    } else if let Some(origin) = &s.origin {
        o.push_str(&format!("- [Sitemap]({origin}/sitemap.xml): Full list of pages\n"));
    }
    o
}

pub fn all(p: &PageData, s: &Suggestions, robots: Option<&Robots>, sitemaps: &[String], path: &str) -> Generated {
    Generated {
        head_html: head_html(p, s),
        json_ld: json_ld(p, s),
        robots_txt: robots_txt(robots, s, sitemaps, path),
        llms_txt: llms_txt(p, s, sitemaps.first().map(String::as_str)),
    }
}
