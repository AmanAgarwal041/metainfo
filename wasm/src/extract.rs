//! Single-pass extraction of everything the checks need from the page HTML.

use scraper::{ElementRef, Html, Node, Selector};
use serde::Serialize;
use serde_json::Value;
use url::Url;

const MAX_LINKS: usize = 400;
const MAX_IMAGES: usize = 200;
const MAX_JSONLD_RAW: usize = 20_000;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaEntry {
    /// `name`, `property`, `http-equiv`, `itemprop` or `charset`: whichever identifies the tag.
    pub key: String,
    pub attr: &'static str,
    pub content: String,
    /// Which consumers read this tag (seomator-style support columns).
    pub engines: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Heading {
    pub level: u8,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Image {
    pub src: String,
    pub alt: Option<String>,
    pub width: Option<String>,
    pub height: Option<String>,
    pub loading: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Link {
    pub href: String,
    pub text: String,
    pub rel: Option<String>,
    pub internal: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Icon {
    pub rel: String,
    pub href: String,
    pub sizes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hreflang {
    pub lang: String,
    pub href: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonLdBlock {
    pub valid: bool,
    pub error: Option<String>,
    pub types: Vec<String>,
    pub raw: String,
    #[serde(skip)]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStats {
    pub internal: usize,
    pub external: usize,
    pub nofollow: usize,
    pub empty_anchor: usize,
    pub generic_anchor: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptStats {
    pub total: usize,
    pub external: usize,
    pub inline: usize,
    pub head_blocking: usize,
    pub is_async: usize,
    pub defer: usize,
    pub module: usize,
    pub inline_bytes: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageData {
    pub lang: Option<String>,
    pub title: Option<String>,
    pub title_count: usize,
    pub description: Option<String>,
    pub description_count: usize,
    pub meta: Vec<MetaEntry>,
    pub canonicals: Vec<String>,
    pub meta_robots: Option<String>,
    pub googlebot: Option<String>,
    pub bingbot: Option<String>,
    pub viewport: Option<String>,
    pub charset: Option<String>,
    pub keywords: Option<String>,
    pub hreflang: Vec<Hreflang>,
    pub open_graph: Vec<KeyValue>,
    pub twitter: Vec<KeyValue>,
    pub icons: Vec<Icon>,
    pub manifest: Option<String>,
    pub theme_color: Option<String>,
    pub generator: Option<String>,
    pub author: Option<String>,
    pub published: Option<String>,
    pub modified: Option<String>,
    pub headings: Vec<Heading>,
    pub images: Vec<Image>,
    pub image_count: usize,
    pub images_missing_alt: usize,
    pub images_missing_size: usize,
    pub images_lazy: usize,
    pub links: Vec<Link>,
    pub link_stats: LinkStats,
    pub json_ld: Vec<JsonLdBlock>,
    pub microdata_types: Vec<String>,
    pub scripts: ScriptStats,
    pub stylesheets: usize,
    pub head_blocking_styles: usize,
    pub iframes: usize,
    pub has_noscript: bool,
    pub spa_shell: bool,
    pub mixed_content: usize,
    pub nosnippet_elements: usize,
    pub word_count: usize,
    pub html_bytes: usize,
    pub text_ratio: f64,
    pub paragraphs: usize,
    pub lists: usize,
    pub tables: usize,
    pub question_headings: usize,
    pub first_paragraph: Option<String>,
    pub excerpt: String,
    pub topics: Vec<crate::keywords::Term>,
}

impl PageData {
    pub fn og(&self, key: &str) -> Option<&str> {
        self.open_graph.iter().find(|kv| kv.key == key).map(|kv| kv.value.as_str()).filter(|v| !v.is_empty())
    }
    pub fn tw(&self, key: &str) -> Option<&str> {
        self.twitter.iter().find(|kv| kv.key == key).map(|kv| kv.value.as_str()).filter(|v| !v.is_empty())
    }
    pub fn h1s(&self) -> impl Iterator<Item = &Heading> {
        self.headings.iter().filter(|h| h.level == 1)
    }
    /// All JSON-LD entities, with arrays and `@graph` flattened.
    pub fn ld_entities(&self) -> Vec<&Value> {
        let mut out = Vec::new();
        for block in &self.json_ld {
            if let Some(v) = &block.data {
                flatten_ld(v, &mut out);
            }
        }
        out
    }
}

pub fn flatten_ld<'a>(v: &'a Value, out: &mut Vec<&'a Value>) {
    match v {
        Value::Array(items) => items.iter().for_each(|i| flatten_ld(i, out)),
        Value::Object(map) => {
            if let Some(graph) = map.get("@graph") {
                flatten_ld(graph, out);
            }
            if map.contains_key("@type") {
                out.push(v);
            }
        }
        _ => {}
    }
}

/// Every typed object at any depth (e.g. an Article's nested `publisher`).
pub fn nested_ld<'a>(v: &'a Value, out: &mut Vec<&'a Value>) {
    match v {
        Value::Array(items) => items.iter().for_each(|i| nested_ld(i, out)),
        Value::Object(map) => {
            if map.contains_key("@type") {
                out.push(v);
            }
            map.values().for_each(|i| nested_ld(i, out));
        }
        _ => {}
    }
}

pub fn ld_types(v: &Value) -> Vec<String> {
    match v.get("@type") {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a.iter().filter_map(|t| t.as_str().map(String::from)).collect(),
        _ => vec![],
    }
}

fn sel(s: &str) -> Selector {
    Selector::parse(s).expect("static selector")
}

pub fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            space = true;
        } else {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.push(ch);
        }
    }
    out
}

fn text_of(el: ElementRef) -> String {
    let mut buf = String::new();
    collect_text(el, &mut buf, &[]);
    collapse_ws(&buf)
}

const SKIP_TEXT: [&str; 7] = ["script", "style", "noscript", "template", "svg", "iframe", "canvas"];

const BLOCK_TAGS: [&str; 32] = [
    "p",
    "div",
    "li",
    "ul",
    "ol",
    "dl",
    "dt",
    "dd",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "section",
    "article",
    "nav",
    "header",
    "footer",
    "aside",
    "main",
    "table",
    "tr",
    "td",
    "th",
    "blockquote",
    "figcaption",
    "br",
    "button",
    "option",
    "label",
    "form",
];

/// The text keyword analysis runs on: the main content region when there is
/// one, else the whole body, with block boundaries kept as newlines.
fn keyword_body(doc: &Html) -> Option<String> {
    doc.select(&sel("main, article, [role=main]"))
        .next()
        .filter(|el| text_of(*el).len() > 200)
        .or_else(|| doc.select(&sel("body")).next())
        .map(block_text_of)
}

/// How often each term (1-3 words) appears in a page's main text.
pub fn term_counts(html: &str, terms: &[String]) -> Vec<usize> {
    let doc = Html::parse_document(html);
    let body = keyword_body(&doc).unwrap_or_default();
    crate::keywords::count_terms(&body, terms)
}

/// Body text with block boundaries kept as newlines.
fn block_text_of(el: ElementRef) -> String {
    let mut buf = String::new();
    // Code samples aren't topics.
    collect_text(el, &mut buf, &["pre", "code", "kbd", "samp"]);
    buf
}

fn collect_text(el: ElementRef, out: &mut String, also_skip: &[&str]) {
    for child in el.children() {
        match child.value() {
            Node::Text(t) => {
                out.push_str(t);
            }
            Node::Element(e) => {
                if SKIP_TEXT.contains(&e.name()) || also_skip.contains(&e.name()) {
                    continue;
                }
                if let Some(c) = ElementRef::wrap(child) {
                    // Newlines mark block boundaries (keyword phrases never cross them);
                    // text_of() collapses them back to spaces.
                    let sep = if BLOCK_TAGS.contains(&e.name()) { '\n' } else { ' ' };
                    out.push(sep);
                    collect_text(c, out, also_skip);
                    out.push(sep);
                }
            }
            _ => {}
        }
    }
}

fn attr(el: &ElementRef, name: &str) -> Option<String> {
    el.value().attr(name).map(|s| s.trim().to_string())
}

fn meta_engines(attr: &str, key: &str) -> Vec<&'static str> {
    let k = key.to_ascii_lowercase();
    let mut e = Vec::new();
    let google = matches!(
        k.as_str(),
        "description"
            | "robots"
            | "googlebot"
            | "googlebot-news"
            | "google"
            | "google-site-verification"
            | "viewport"
            | "rating"
            | "content-type"
            | "refresh"
            | "charset"
            | "theme-color"
    );
    let bing = matches!(
        k.as_str(),
        "description"
            | "robots"
            | "bingbot"
            | "msvalidate.01"
            | "viewport"
            | "content-type"
            | "charset"
            | "keywords"
            | "refresh"
    );
    if google {
        e.push("google");
    }
    if bing {
        e.push("bing");
    }
    if attr == "property" && k.starts_with("og:") || k.starts_with("article:") || k.starts_with("fb:") {
        e.push("social");
    }
    if k.starts_with("twitter:") {
        e.push("x");
    }
    if matches!(k.as_str(), "description" | "author" | "article:published_time" | "article:modified_time")
        || k.starts_with("og:")
    {
        e.push("ai");
    }
    e
}

const GENERIC_ANCHORS: [&str; 10] =
    ["click here", "here", "read more", "more", "learn more", "link", "this", "continue", "click", "go"];

pub fn extract(html: &str, base: Option<&Url>) -> PageData {
    let doc = Html::parse_document(html);
    let mut p = PageData { html_bytes: html.len(), ..Default::default() };
    let base_host = base.and_then(|b| b.host_str()).map(|h| h.trim_start_matches("www.").to_string());
    let https_page = base.map(|b| b.scheme() == "https").unwrap_or(false);

    if let Some(root) = doc.select(&sel("html")).next() {
        p.lang = attr(&root, "lang").filter(|s| !s.is_empty());
    }

    // ---- head-ish elements (we don't restrict to <head>: html5ever already
    // moves stray head tags, and Google reads what it can find).
    let titles: Vec<_> = doc.select(&sel("title")).filter(|t| !in_svg(t)).collect();
    p.title_count = titles.len();
    p.title = titles.first().map(|t| collapse_ws(&t.text().collect::<String>())).filter(|s| !s.is_empty());

    for m in doc.select(&sel("meta")) {
        let v = m.value();
        if let Some(cs) = v.attr("charset") {
            p.charset = Some(cs.trim().to_string());
            p.meta.push(MetaEntry {
                key: "charset".into(),
                attr: "charset",
                content: cs.trim().into(),
                engines: meta_engines("charset", "charset"),
            });
            continue;
        }
        let content = v.attr("content").map(|s| s.trim().to_string()).unwrap_or_default();
        let (attr_name, key) = if let Some(n) = v.attr("name") {
            ("name", n.trim().to_string())
        } else if let Some(n) = v.attr("property") {
            ("property", n.trim().to_string())
        } else if let Some(n) = v.attr("http-equiv") {
            ("http-equiv", n.trim().to_string())
        } else if let Some(n) = v.attr("itemprop") {
            ("itemprop", n.trim().to_string())
        } else {
            continue;
        };
        let lk = key.to_ascii_lowercase();
        match lk.as_str() {
            "description" => {
                p.description_count += 1;
                if p.description.is_none() {
                    p.description = Some(collapse_ws(&content));
                }
            }
            "robots" => p.meta_robots = Some(content.to_ascii_lowercase()),
            "googlebot" => p.googlebot = Some(content.to_ascii_lowercase()),
            "bingbot" => p.bingbot = Some(content.to_ascii_lowercase()),
            "viewport" => p.viewport = Some(content.clone()),
            "keywords" => p.keywords = Some(content.clone()),
            "theme-color" => p.theme_color = Some(content.clone()),
            "generator" => p.generator = Some(content.clone()),
            "author" | "article:author" if p.author.is_none() => p.author = Some(content.clone()),
            "article:published_time" | "datepublished" | "date" | "dc.date" | "pubdate" if p.published.is_none() => {
                p.published = Some(content.clone())
            }
            "article:modified_time" | "og:updated_time" | "datemodified" | "last-modified" if p.modified.is_none() => {
                p.modified = Some(content.clone())
            }
            "content-type" if p.charset.is_none() => {
                if let Some(i) = content.to_ascii_lowercase().find("charset=") {
                    p.charset = Some(content[i + 8..].trim().to_string());
                }
            }
            _ => {}
        }
        if lk.starts_with("og:") {
            p.open_graph.push(KeyValue { key: lk.clone(), value: content.clone() });
        } else if lk.starts_with("twitter:") {
            p.twitter.push(KeyValue { key: lk.clone(), value: content.clone() });
        }
        p.meta.push(MetaEntry { engines: meta_engines(attr_name, &key), key, attr: attr_name, content });
    }

    for l in doc.select(&sel("link[rel]")) {
        let rel = l.value().attr("rel").unwrap_or("").to_ascii_lowercase();
        let href = attr(&l, "href").unwrap_or_default();
        let rels: Vec<&str> = rel.split_whitespace().collect();
        if rels.contains(&"canonical") {
            p.canonicals.push(href.clone());
        }
        if rels.contains(&"alternate") {
            if let Some(hl) = attr(&l, "hreflang") {
                p.hreflang.push(Hreflang { lang: hl, href: href.clone() });
            }
        }
        if rels.iter().any(|r| *r == "icon" || *r == "apple-touch-icon" || *r == "mask-icon") {
            p.icons.push(Icon { rel: rel.clone(), href: href.clone(), sizes: attr(&l, "sizes") });
        }
        if rels.contains(&"manifest") {
            p.manifest = Some(href.clone());
        }
        if rels.contains(&"author") && p.author.is_none() {
            p.author = Some(href.clone());
        }
        if rels.contains(&"stylesheet") {
            p.stylesheets += 1;
            let media = l.value().attr("media").unwrap_or("all");
            if in_head(&l) && (media == "all" || media == "screen") {
                p.head_blocking_styles += 1;
            }
        }
        if https_page && href.starts_with("http://") && rels.contains(&"stylesheet") {
            p.mixed_content += 1;
        }
    }

    // ---- scripts & JSON-LD
    for s in doc.select(&sel("script")) {
        let ty = s.value().attr("type").unwrap_or("").trim().to_ascii_lowercase();
        if ty == "application/ld+json" {
            let raw: String = s.text().collect();
            p.json_ld.push(parse_jsonld(&raw));
            continue;
        }
        let is_js = ty.is_empty() || ty.contains("javascript") || ty == "module";
        if !is_js {
            continue;
        }
        p.scripts.total += 1;
        let src = s.value().attr("src");
        let is_async = s.value().attr("async").is_some();
        let defer = s.value().attr("defer").is_some();
        if ty == "module" {
            p.scripts.module += 1;
        }
        if is_async {
            p.scripts.is_async += 1;
        }
        if defer {
            p.scripts.defer += 1;
        }
        match src {
            Some(src) => {
                p.scripts.external += 1;
                if in_head(&s) && !is_async && !defer && ty != "module" {
                    p.scripts.head_blocking += 1;
                }
                if https_page && src.trim().starts_with("http://") {
                    p.mixed_content += 1;
                }
            }
            None => {
                p.scripts.inline += 1;
                p.scripts.inline_bytes += s.text().map(str::len).sum::<usize>();
            }
        }
    }

    // ---- microdata
    for el in doc.select(&sel("[itemtype]")) {
        if let Some(t) = el.value().attr("itemtype") {
            let t = t.rsplit('/').next().unwrap_or(t).to_string();
            if !p.microdata_types.contains(&t) {
                p.microdata_types.push(t);
            }
        }
    }

    // ---- body content
    for h in doc.select(&sel("h1, h2, h3, h4, h5, h6")) {
        let level = h.value().name().as_bytes()[1] - b'0';
        let text = text_of(h);
        if text.trim_end().ends_with('?') {
            p.question_headings += 1;
        }
        p.headings.push(Heading { level, text });
    }

    for img in doc.select(&sel("img")) {
        p.image_count += 1;
        let alt = img.value().attr("alt").map(|s| s.trim().to_string());
        let width = attr(&img, "width");
        let height = attr(&img, "height");
        let loading = attr(&img, "loading").map(|s| s.to_ascii_lowercase());
        let src = attr(&img, "src").or_else(|| attr(&img, "data-src")).unwrap_or_default();
        // alt="" is valid for decorative images; only a missing attribute is an error.
        if alt.is_none() {
            p.images_missing_alt += 1;
        }
        if width.is_none() || height.is_none() {
            p.images_missing_size += 1;
        }
        if loading.as_deref() == Some("lazy") {
            p.images_lazy += 1;
        }
        if https_page && src.starts_with("http://") {
            p.mixed_content += 1;
        }
        if p.images.len() < MAX_IMAGES {
            p.images.push(Image { src: resolve(base, &src), alt, width, height, loading });
        }
    }

    for a in doc.select(&sel("a[href]")) {
        let raw = a.value().attr("href").unwrap_or("").trim();
        if raw.starts_with('#')
            || raw.starts_with("javascript:")
            || raw.starts_with("mailto:")
            || raw.starts_with("tel:")
        {
            continue;
        }
        let abs = resolve(base, raw);
        let internal = match (&base_host, Url::parse(&abs).ok()) {
            (Some(bh), Some(u)) => u.host_str().map(|h| h.trim_start_matches("www.") == bh).unwrap_or(false),
            (None, _) => !raw.starts_with("http"),
            _ => false,
        };
        let mut text = text_of(a);
        if text.is_empty() {
            text = attr(&a, "aria-label")
                .or_else(|| attr(&a, "title"))
                .or_else(|| a.select(&sel("img[alt]")).next().and_then(|i| attr(&i, "alt")))
                .unwrap_or_default();
        }
        let rel = attr(&a, "rel").map(|r| r.to_ascii_lowercase());
        if internal {
            p.link_stats.internal += 1;
        } else {
            p.link_stats.external += 1;
        }
        if rel.as_deref().map(|r| r.contains("nofollow")).unwrap_or(false) {
            p.link_stats.nofollow += 1;
        }
        if text.is_empty() {
            p.link_stats.empty_anchor += 1;
        } else if GENERIC_ANCHORS.contains(&text.to_lowercase().trim_end_matches(['.', '…', '→', ' '])) {
            p.link_stats.generic_anchor += 1;
        }
        if p.links.len() < MAX_LINKS {
            p.links.push(Link { href: abs, text, rel, internal });
        }
    }

    p.paragraphs = doc.select(&sel("p")).count();
    p.lists = doc.select(&sel("ul, ol, dl")).count();
    p.tables = doc.select(&sel("table")).count();
    p.iframes = doc.select(&sel("iframe")).count();
    p.has_noscript = doc.select(&sel("noscript")).next().is_some();
    p.nosnippet_elements = doc.select(&sel("[data-nosnippet]")).count();

    p.first_paragraph =
        // Real prose, not a run-together nav/marketing fragment.
        doc.select(&sel("main p, article p, p"))
            .map(text_of)
            .find(|t| t.split_whitespace().count() >= 12 && t.contains(['.', '!', '?']));

    let body_text = doc.select(&sel("body")).next().map(text_of).unwrap_or_default();
    let main_text = doc
        .select(&sel("main, article, [role=main]"))
        .next()
        .map(text_of)
        .filter(|t| t.len() > 200)
        .unwrap_or_else(|| body_text.clone());
    p.word_count = body_text.split_whitespace().count();
    p.text_ratio = if html.is_empty() { 0.0 } else { body_text.len() as f64 / html.len() as f64 };
    p.excerpt = truncate_chars(&main_text, 600);

    if let Some(body) = keyword_body(&doc) {
        let h1: Vec<String> = p.h1s().map(|h| h.text.clone()).collect();
        let headings: Vec<String> = p.headings.iter().map(|h| h.text.clone()).collect();
        p.topics = crate::keywords::extract(&crate::keywords::Zones {
            body: &body,
            title: p.title.as_deref(),
            description: p.description.as_deref(),
            h1: &h1,
            headings: &headings,
            url_path: base.map(|b| b.path()).unwrap_or(""),
        });
    }

    // A JS app shell: an empty mount point and almost no server-rendered text.
    let empty_mount = doc
        .select(&sel("#root, #app, #__next, #__nuxt, #svelte, [data-reactroot], app-root"))
        .any(|el| text_of(el).split_whitespace().count() < 5);
    p.spa_shell = (empty_mount && p.word_count < 150) || (p.word_count < 40 && p.scripts.total >= 2);

    // ---- JSON-LD derived signals
    let (mut ld_author, mut ld_pub, mut ld_mod) = (None, None, None);
    for e in p.ld_entities() {
        if ld_author.is_none() {
            ld_author = e.get("author").and_then(|a| match a {
                Value::String(s) => Some(s.clone()),
                Value::Object(_) => a.get("name").and_then(Value::as_str).map(String::from),
                Value::Array(v) => v.first().and_then(|f| f.get("name")).and_then(Value::as_str).map(String::from),
                _ => None,
            });
        }
        if ld_pub.is_none() {
            ld_pub = e.get("datePublished").and_then(Value::as_str).map(String::from);
        }
        if ld_mod.is_none() {
            ld_mod = e.get("dateModified").and_then(Value::as_str).map(String::from);
        }
    }
    if p.author.is_none() {
        p.author = ld_author;
    }
    if p.published.is_none() {
        p.published = ld_pub;
    }
    if p.modified.is_none() {
        p.modified = ld_mod;
    }
    // <time datetime> as a last resort for freshness.
    if p.modified.is_none() && p.published.is_none() {
        p.published = doc.select(&sel("time[datetime]")).next().and_then(|t| attr(&t, "datetime"));
    }

    p
}

fn in_head(el: &ElementRef) -> bool {
    el.ancestors().any(|a| matches!(a.value(), Node::Element(e) if e.name() == "head"))
}

fn in_svg(el: &ElementRef) -> bool {
    el.ancestors().any(|a| matches!(a.value(), Node::Element(e) if e.name() == "svg"))
}

pub fn resolve(base: Option<&Url>, href: &str) -> String {
    match base {
        Some(b) => b.join(href).map(|u| u.to_string()).unwrap_or_else(|_| href.to_string()),
        None => href.to_string(),
    }
}

pub fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    // back off to a word boundary
    match cut.rfind(' ') {
        Some(i) if i > max / 2 => format!("{}…", cut[..i].trim_end_matches([',', ';', ':', '-'])),
        _ => format!("{cut}…"),
    }
}

fn parse_jsonld(raw: &str) -> JsonLdBlock {
    let cleaned = raw
        .trim()
        .trim_start_matches("<!--")
        .trim_end_matches("-->")
        .trim()
        .trim_start_matches("//<![CDATA[")
        .trim_end_matches("//]]>")
        .trim();
    let raw_out = truncate_chars(cleaned, MAX_JSONLD_RAW);
    match serde_json::from_str::<Value>(cleaned) {
        Ok(v) => {
            let mut ents = Vec::new();
            flatten_ld(&v, &mut ents);
            let mut types: Vec<String> = ents.iter().flat_map(|e| ld_types(e)).collect();
            types.dedup();
            JsonLdBlock { valid: true, error: None, types, raw: raw_out, data: Some(v) }
        }
        Err(e) => JsonLdBlock { valid: false, error: Some(e.to_string()), types: vec![], raw: raw_out, data: None },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_core_tags() {
        let html = r#"<!doctype html><html lang="en"><head>
            <meta charset="utf-8"><title> Hello  World </title>
            <meta name="description" content="A page">
            <meta property="og:title" content="OG">
            <link rel="canonical" href="https://ex.com/a">
            <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Ex"},{"@type":"WebSite"}]}</script>
            <script src="/app.js"></script>
            </head><body><h1>Title</h1><h2>Why?</h2><p>Some text here</p>
            <img src="/a.png"><a href="/x">click here</a><a href="https://other.com">Other</a></body></html>"#;
        let base = Url::parse("https://ex.com/a").unwrap();
        let p = extract(html, Some(&base));
        assert_eq!(p.title.as_deref(), Some("Hello World"));
        assert_eq!(p.lang.as_deref(), Some("en"));
        assert_eq!(p.description.as_deref(), Some("A page"));
        assert_eq!(p.og("og:title"), Some("OG"));
        assert_eq!(p.canonicals, vec!["https://ex.com/a"]);
        assert_eq!(p.json_ld[0].types, vec!["Organization", "WebSite"]);
        assert_eq!(p.scripts.head_blocking, 1);
        assert_eq!(p.question_headings, 1);
        assert_eq!(p.images_missing_alt, 1);
        assert_eq!(p.link_stats.internal, 1);
        assert_eq!(p.link_stats.external, 1);
        assert_eq!(p.link_stats.generic_anchor, 1);
        assert_eq!(p.links[0].href, "https://ex.com/x");
    }

    #[test]
    fn detects_spa_shell() {
        let html = r#"<html><head><script src="a.js"></script><script src="b.js"></script></head><body><div id="root"></div></body></html>"#;
        assert!(extract(html, None).spa_shell);
    }
}
