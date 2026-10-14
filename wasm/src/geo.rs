//! Generative-engine optimisation (GEO): how quotable a page is for AI answer
//! engines. Deterministic ports of the rubrics in the open-source SEO skills
//! (geo-seo-claude's passage citability scorer, claude-seo's content-quality
//! and claim checks, marketingskills' audit checklist):
//!
//! * passage citability: each section scored 0-100 on answer quality,
//!   self-containment, readability, statistics and originality;
//! * answer-first structure: question headings followed by a direct answer;
//! * evidence: factual claims with a nearby source, statistics density;
//! * phrasing: filler and stock AI-writing phrases;
//! * freshness: age of the last update, stale years in the title;
//! * trust pages and the schema entity graph;
//! * a GEO score (claude-seo weights: citability 25, structure 20,
//!   multi-modal 15, authority 20, technical access 20).

use crate::extract::{collapse_ws, truncate_chars, PageData};
use crate::schema::{SchemaReport, SdItem, SdValue};
use scraper::{ElementRef, Html, Node, Selector};
use serde::Serialize;

/// Marks where an outbound link sat in the text, for "is this claim sourced?".
const LINK: char = '\u{1}';

// ------------------------------------------------------------------ model

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Passage {
    pub heading: Option<String>,
    pub excerpt: String,
    pub words: usize,
    pub score: u32,
    pub answer: u32,
    pub self_contained: u32,
    pub readability: u32,
    pub stats: u32,
    pub originality: u32,
    /// Opens with "But/However/And/This…", so it leans on the previous section.
    pub context_dependent: bool,
    /// Position in the page, 0-100 (% of the way down).
    pub position: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Citability {
    /// Mean of the five best passages.
    pub score: u32,
    pub grade: &'static str,
    pub passages: usize,
    /// Share of passages scoring above 70.
    pub coverage: u32,
    pub top: Vec<Passage>,
    pub bottom: Vec<Passage>,
    pub context_dependent: usize,
    /// Where the best passage sits (% down the page): AI answers lean on the first third.
    pub best_position: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answers {
    pub question_headings: usize,
    pub answered: usize,
    /// Question headings with no direct answer right below.
    pub unanswered: Vec<String>,
    /// "X is a…" style definition in the first 60 words of the main content.
    pub early_definition: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub claims: usize,
    pub cited: usize,
    pub uncited_examples: Vec<String>,
    /// Numbers and statistics per 500 words.
    pub stats_per_500: f64,
    /// (numbers + named entities) per 100 words.
    pub density: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Phrasing {
    pub filler: Vec<(String, usize)>,
    pub ai_patterns: Vec<(String, usize)>,
    pub filler_per_1k: f64,
    pub ai_per_1k: f64,
    pub em_dashes: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Freshness {
    pub date: Option<String>,
    pub age_days: Option<i64>,
    /// excellent (<3 months), good (<6), acceptable (<12), warning (<24), stale, unknown.
    pub tier: &'static str,
    /// A year in the title older than the current year ("Best tools 2023").
    pub title_year: Option<i32>,
    pub vague_time: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trust {
    pub about: bool,
    pub contact: bool,
    pub privacy: bool,
    pub terms: bool,
    pub editorial: bool,
    /// Person schema with jobTitle / worksFor / sameAs (a credentialed author).
    pub author_profile: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityGraph {
    /// An Organization or Person item exists (otherwise the "entity" check covers it).
    pub has_entity: bool,
    pub id_references: usize,
    pub same_as: Vec<String>,
    pub knows_about: usize,
    pub speakable: bool,
    pub search_action: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoScore {
    pub total: u32,
    pub citability: u32,
    pub structure: u32,
    pub multimodal: u32,
    pub authority: u32,
    pub technical: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoReport {
    pub citability: Citability,
    pub answers: Answers,
    pub evidence: Evidence,
    pub phrasing: Phrasing,
    pub freshness: Freshness,
    pub trust: Trust,
    pub entity: EntityGraph,
    pub score: GeoScore,
}

// ------------------------------------------------------------------ text helpers

fn sel(s: &str) -> Selector {
    Selector::parse(s).expect("static selector")
}

const SKIP: &[&str] = &["script", "style", "noscript", "template", "svg", "nav", "footer", "header", "aside", "form", "button", "select", "iframe", "canvas"];
const BREAK: &[&str] = &["p", "li", "div", "br", "td", "th", "tr", "blockquote", "pre", "dd", "dt", "section", "article", "figcaption", "ul", "ol", "table"];

struct Block {
    heading: Option<String>,
    text: String,
    lines: usize,
}

/// Split the main content into sections at h1-h4, outside navigation and chrome.
fn blocks(doc: &Html, base_host: Option<&str>) -> Vec<Block> {
    let root = doc
        .select(&sel("main, article, [role=main]"))
        .next()
        .or_else(|| doc.select(&sel("body")).next());
    let Some(root) = root else { return vec![] };
    let mut out = vec![Block { heading: None, text: String::new(), lines: 0 }];
    fn walk(el: ElementRef, out: &mut Vec<Block>, host: Option<&str>) {
        for child in el.children() {
            match child.value() {
                Node::Text(t) => {
                    let b = out.last_mut().unwrap();
                    b.text.push_str(t);
                }
                Node::Element(e) => {
                    let name = e.name();
                    if SKIP.contains(&name) {
                        continue;
                    }
                    let Some(ce) = ElementRef::wrap(child) else { continue };
                    if matches!(name, "h1" | "h2" | "h3" | "h4") {
                        out.push(Block { heading: Some(collapse_ws(&ce.text().collect::<String>())), text: String::new(), lines: 0 });
                        continue;
                    }
                    if name == "a" {
                        let external = e
                            .attr("href")
                            .map(|h| h.starts_with("http") && host.map(|x| !h.contains(x)).unwrap_or(true))
                            .unwrap_or(false);
                        walk(ce, out, host);
                        if external {
                            out.last_mut().unwrap().text.push(LINK);
                        }
                        continue;
                    }
                    walk(ce, out, host);
                    if BREAK.contains(&name) {
                        let b = out.last_mut().unwrap();
                        b.text.push('\n');
                        b.lines += 1;
                    }
                }
                _ => {}
            }
        }
    }
    walk(root, &mut out, base_host);
    out
}

fn words(s: &str) -> Vec<&str> {
    s.split_whitespace().filter(|w| w.chars().any(char::is_alphanumeric)).collect()
}

fn bare(w: &str) -> String {
    w.trim_matches(|c: char| !c.is_alphanumeric() && c != '%' && c != '$').to_lowercase()
}

fn sentences(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = s.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        cur.push(c);
        let end = matches!(c, '.' | '!' | '?') && chars.get(i + 1).map(|n| n.is_whitespace()).unwrap_or(true);
        if end || c == '\n' {
            let t = cur.trim().to_string();
            if words(&t).len() >= 3 {
                out.push(t);
            }
            cur.clear();
        }
    }
    let t = cur.trim().to_string();
    if words(&t).len() >= 3 {
        out.push(t);
    }
    out
}

fn count_phrase(hay: &str, needle: &str) -> usize {
    // Whole-word-ish matching on lower-cased, space-normalised text.
    let mut n = 0;
    let mut start = 0;
    while let Some(i) = hay[start..].find(needle) {
        let at = start + i;
        let before = hay[..at].chars().last().map(|c| !c.is_alphanumeric()).unwrap_or(true);
        let after = hay[at + needle.len()..].chars().next().map(|c| !c.is_alphanumeric()).unwrap_or(true);
        if before && after {
            n += 1;
        }
        start = at + needle.len();
    }
    n
}

fn is_number(w: &str) -> bool {
    let t = w.trim_matches(|c: char| !c.is_ascii_digit() && c != '.' && c != ',');
    !t.is_empty() && t.chars().any(|c| c.is_ascii_digit()) && t.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ',')
}

fn is_year(w: &str) -> Option<i32> {
    let t = w.trim_matches(|c: char| !c.is_ascii_digit());
    if t.len() == 4 {
        t.parse::<i32>().ok().filter(|y| (1990..=2100).contains(y))
    } else {
        None
    }
}

/// Capitalised words that don't start a sentence: a cheap named-entity count.
fn proper_nouns(s: &str) -> usize {
    let mut n = 0;
    let mut sentence_start = true;
    for w in s.split_whitespace() {
        let first = w.chars().find(|c| c.is_alphabetic());
        if !sentence_start && first.map(char::is_uppercase).unwrap_or(false) && w.chars().filter(|c| c.is_alphabetic()).count() > 1 {
            n += 1;
        }
        sentence_start = w.ends_with(['.', '!', '?', ':']);
    }
    n
}

// ------------------------------------------------------------------ citability

const PRONOUNS: &[&str] = &["it", "its", "they", "them", "their", "this", "that", "these", "those", "he", "she", "him", "her", "his"];
const SEQUENCE: &[&str] = &["first", "second", "third", "finally", "next", "then", "lastly", "step"];
const SOURCES: &[&str] = &["gartner", "mckinsey", "forrester", "statista", "pew", "deloitte", "harvard", "stanford", "nielsen", "hubspot", "census", "who", "oecd", "world bank"];
const UNITS: &[&str] = &["users", "customers", "people", "companies", "businesses", "downloads", "members", "visitors", "employees", "sites", "websites", "teams", "students", "patients"];
const OPENERS: &[&str] = &["but", "however", "and", "also", "this", "that", "these", "it", "they", "additionally", "furthermore", "moreover"];

fn score_block(b: &Block, position: u32) -> Passage {
    let text = b.text.replace(LINK, " ");
    let t = collapse_ws(&text);
    let lower = t.to_lowercase();
    let ws = words(&t);
    let n = ws.len();
    let sents = sentences(&text);
    let first60 = ws.iter().take(60).map(|w| w.to_lowercase()).collect::<Vec<_>>().join(" ");

    // Answer quality (30)
    let mut answer = 0u32;
    let definition = [" is a ", " is an ", " is the ", " are a ", " are the ", " refers to ", " defined as ", " means "].iter().any(|p| lower.contains(p));
    if definition {
        answer += 15;
    }
    if [" is ", " are ", " means "].iter().any(|p| first60.contains(p)) || first60.contains('%') || first60.contains('$') || first60.contains(" million") || first60.contains(" billion") {
        answer += 15;
    }
    if b.heading.as_deref().map(|h| h.trim_end().ends_with('?')).unwrap_or(false) {
        answer += 10;
    }
    if !sents.is_empty() {
        let good = sents.iter().filter(|s| (5..=25).contains(&words(s).len())).count();
        answer += (good * 10 / sents.len()) as u32;
    }
    if ["according to", "research shows", "data shows", "studies show", "study found", "survey found"].iter().any(|p| lower.contains(p)) {
        answer += 10;
    }
    let answer = answer.min(30);

    // Self-containment (25)
    let mut selfc = match n {
        134..=167 => 10,
        100..=200 => 7,
        80..=250 => 4,
        30..=400 => 2,
        _ => 0,
    };
    let pron = ws.iter().filter(|w| PRONOUNS.contains(&bare(w).as_str())).count() as f64 / n.max(1) as f64;
    selfc += if pron < 0.02 { 8 } else if pron < 0.04 { 5 } else if pron < 0.06 { 3 } else { 0 };
    let pn = proper_nouns(&t);
    selfc += if pn >= 3 { 7 } else if pn >= 1 { 4 } else { 0 };
    let selfc = (selfc as u32).min(25);

    // Readability (20)
    let avg = if sents.is_empty() { n as f64 } else { sents.iter().map(|s| words(s).len()).sum::<usize>() as f64 / sents.len() as f64 };
    let mut read = if (10.0..=20.0).contains(&avg) { 8 } else if (8.0..=25.0).contains(&avg) { 5 } else { 2 };
    if ws.iter().any(|w| SEQUENCE.contains(&bare(w).as_str())) {
        read += 4;
    }
    if text.lines().any(|l| {
        let l = l.trim_start();
        l.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) && (l.contains(". ") || l.contains(") "))
    }) || lower.contains("step 1")
    {
        read += 4;
    }
    if b.lines >= 3 {
        read += 4;
    }
    let read = (read as u32).min(20);

    // Statistics (15)
    let pct = ws.iter().filter(|w| w.contains('%')).count();
    let usd = ws.iter().filter(|w| w.starts_with('$') && w.chars().any(|c| c.is_ascii_digit())).count();
    let counted = ws.windows(2).filter(|p| is_number(p[0]) && UNITS.contains(&bare(p[1]).as_str())).count();
    let mut stats = (pct * 3).min(6) + (usd * 3).min(5) + (counted * 2).min(4);
    if ws.iter().any(|w| is_year(w).is_some()) {
        stats += 2;
    }
    let named = SOURCES.iter().filter(|s| count_phrase(&lower, s) > 0).count() + count_phrase(&lower, "according to");
    stats += named * 2;
    let stats = (stats as u32).min(15);

    // Originality (10)
    let mut orig = 0;
    if ["our research", "we found", "our data", "our study", "we analyzed", "we analysed", "we tested", "our survey", "in our experience"].iter().any(|p| lower.contains(p)) {
        orig += 5;
    }
    if ["case study", "for example", "for instance", "e.g."].iter().any(|p| lower.contains(p)) {
        orig += 3;
    }
    if ws.windows(2).any(|p| bare(p[0]) == "using" && p[1].chars().next().map(char::is_uppercase).unwrap_or(false)) {
        orig += 2;
    }
    let orig = (orig as u32).min(10);

    let first = ws.first().map(|w| bare(w)).unwrap_or_default();
    Passage {
        heading: b.heading.clone(),
        excerpt: truncate_chars(&t, 220),
        words: n,
        score: answer + selfc + read + stats + orig,
        answer,
        self_contained: selfc,
        readability: read,
        stats,
        originality: orig,
        context_dependent: OPENERS.contains(&first.as_str()),
        position,
    }
}

/// Sections nobody quotes: link lists ("See also", "References"), and list- or
/// table-shaped blocks (ingredients, pricing cards, spec sheets) whose lines are
/// a few words each.
fn is_prose(b: &Block) -> bool {
    const NAV: &[&str] = &["see also", "references", "notes", "external links", "further reading", "sources", "bibliography", "related", "related articles", "contents", "table of contents"];
    if b.heading.as_deref().map(|h| NAV.contains(&h.trim().to_lowercase().as_str())).unwrap_or(false) {
        return false;
    }
    let text = b.text.replace(LINK, " ");
    let n = words(&text).len().max(1);
    if b.text.matches(LINK).count() * 100 / n > 15 {
        return false;
    }
    let lines: Vec<usize> = text.lines().map(|l| words(l).len()).filter(|w| *w > 0).collect();
    !(lines.len() >= 4 && lines.iter().sum::<usize>() / lines.len() < 7)
}

fn grade(score: u32) -> &'static str {
    match score {
        80.. => "A",
        65..=79 => "B",
        50..=64 => "C",
        35..=49 => "D",
        _ => "F",
    }
}

// ------------------------------------------------------------------ phrase lists

/// Wordy filler (claude-seo / marketingskills): each hit adds words, not meaning.
const FILLER: &[&str] = &[
    "in order to", "due to the fact that", "at this point in time", "needless to say", "it goes without saying", "for all intents and purposes",
    "as a matter of fact", "it should be noted that", "the fact that", "in the event that", "at the end of the day", "each and every",
    "basically", "essentially", "literally", "first and foremost",
];
/// Stock phrasing common in unedited AI drafts (marketingskills ai-writing-detection).
const AI_PATTERNS: &[&str] = &[
    "delve", "in today's fast-paced", "in today's digital", "in the ever-evolving", "ever-changing landscape", "it's important to note",
    "it is important to note", "it's worth noting", "it is worth noting", "navigate the complexities", "a testament to", "rich tapestry",
    "unlock the power", "unlock the potential", "game-changer", "game changer", "seamlessly", "elevate your", "embark on", "look no further",
    "dive into", "dive deep", "in conclusion", "harness the power", "cutting-edge", "revolutionize", "revolutionise", "pivotal role",
    "plays a crucial role", "the realm of", "whether you're a", "meticulously",
];
const VAGUE_TIME: &[&str] = &["currently", "recently", "nowadays", "these days", "this year", "right now", "at the moment", "latest"];
const CLAIM_MARKERS: &[&str] = &[
    "study", "studies", "research", "survey", "report", "according to", "experts", "statistics", "data shows", "proven", "percent", "majority",
    "most people", "times more", "times faster", "on average", "billion", "million",
];

// ------------------------------------------------------------------ dates

/// Days since 1970-01-01 for a YYYY-MM-DD prefix.
fn days(date: &str) -> Option<i64> {
    let d = date.get(..10)?;
    let y: i64 = d.get(..4)?.parse().ok()?;
    let m: i64 = d.get(5..7)?.parse().ok()?;
    let day: i64 = d.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&day) {
        return None;
    }
    // Howard Hinnant's days_from_civil.
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146097 + doe - 719468)
}

// ------------------------------------------------------------------ entity graph

fn walk_items<'a>(i: &'a SdItem, out: &mut Vec<&'a SdItem>) {
    out.push(i);
    for p in &i.properties {
        for v in &p.values {
            if let SdValue::Item { item } = v {
                walk_items(item, out);
            }
        }
    }
}

fn prop<'a>(i: &'a SdItem, name: &'a str) -> impl Iterator<Item = &'a SdValue> + 'a {
    i.properties.iter().filter(move |p| short(&p.name) == name).flat_map(|p| p.values.iter())
}

fn short(t: &str) -> &str {
    t.rsplit('/').next().unwrap_or(t)
}

// ------------------------------------------------------------------ entry point

pub fn analyze(html: &str, page: &PageData, schema: &SchemaReport, host: Option<&str>, now_ms: Option<f64>) -> GeoReport {
    let doc = Html::parse_document(html);
    let raw_blocks = blocks(&doc, host);
    let total_words: usize = raw_blocks.iter().map(|b| words(&b.text.replace(LINK, " ")).len()).sum::<usize>().max(1);

    // Citability
    let mut seen = 0usize;
    let mut passages: Vec<Passage> = Vec::new();
    for b in &raw_blocks {
        let n = words(&b.text.replace(LINK, " ")).len();
        let pos = (seen * 100 / total_words) as u32;
        seen += n;
        if n >= 20 && is_prose(b) {
            passages.push(score_block(b, pos));
        }
    }
    let mut ranked = passages.clone();
    ranked.sort_by(|a, b| b.score.cmp(&a.score).then(a.position.cmp(&b.position)));
    let top5: Vec<Passage> = ranked.iter().take(5).cloned().collect();
    let score = if top5.is_empty() { 0 } else { top5.iter().map(|p| p.score).sum::<u32>() / top5.len() as u32 };
    // Rewrite candidates: the weakest sections, never the ones shown as most quotable.
    let best3: Vec<u32> = ranked.iter().take(3).map(|p| p.position).collect();
    let mut bottom: Vec<Passage> = ranked.iter().rev().filter(|p| p.score < 60 && !best3.contains(&p.position)).take(5).cloned().collect();
    bottom.sort_by_key(|p| p.score);
    let citability = Citability {
        score,
        grade: if passages.is_empty() { "-" } else { grade(score) },
        passages: passages.len(),
        coverage: if passages.is_empty() { 0 } else { (passages.iter().filter(|p| p.score > 70).count() * 100 / passages.len()) as u32 },
        best_position: top5.first().map(|p| p.position),
        top: top5,
        bottom,
        context_dependent: passages.iter().filter(|p| p.context_dependent).count(),
    };

    // Answer-first: a question heading should be followed by a direct answer (claude-seo / geo-seo: 40-60 words; we accept 15-120).
    let mut answers = Answers::default();
    for b in raw_blocks.iter().filter(|b| b.heading.as_deref().map(|h| h.trim_end().ends_with('?')).unwrap_or(false)) {
        answers.question_headings += 1;
        let first = sentences(&b.text.replace(LINK, " ")).into_iter().take(3).collect::<Vec<_>>().join(" ");
        let n = words(&first).len();
        if (15..=120).contains(&n) {
            answers.answered += 1;
        } else if answers.unanswered.len() < 6 {
            answers.unanswered.push(truncate_chars(b.heading.as_deref().unwrap_or(""), 120));
        }
    }
    let main_text: String = raw_blocks.iter().map(|b| b.text.replace(LINK, " ")).collect::<Vec<_>>().join(" ");
    let first60 = words(&main_text).into_iter().take(60).collect::<Vec<_>>().join(" ").to_lowercase();
    answers.early_definition = [" is a ", " is an ", " is the ", " refers to ", " are a "].iter().any(|p| first60.contains(p));

    // Evidence: claims and whether a source sits nearby (a link or attribution within 200 chars).
    let full: String = raw_blocks.iter().map(|b| b.text.as_str()).collect::<Vec<_>>().join("\n");
    let mut evidence = Evidence::default();
    let mut offset = 0usize;
    let chars: Vec<char> = full.chars().collect();
    for s in sentences(&full) {
        let lower = s.to_lowercase().replace(LINK, " ");
        // A claim needs claim language: a percentage or a research/comparison phrase. Plain
        // quantities (ingredient amounts, "100+ payment methods") aren't claims.
        let claim = s.contains('%') || CLAIM_MARKERS.iter().any(|m| count_phrase(&lower, m) > 0);
        // Find the sentence in the text to look at its surroundings.
        let at = full[offset.min(full.len())..].find(s.as_str()).map(|i| i + offset);
        if let Some(a) = at {
            offset = a;
        }
        if !claim {
            continue;
        }
        evidence.claims += 1;
        let cited = s.contains(LINK)
            || ["according to", "source:", "sources:", " per ", "said", "reports", "found that", "cited"].iter().any(|m| lower.contains(m))
            // Attribution in the sentence itself: a named research firm, or "X's study/report/survey".
            || SOURCES.iter().any(|src| count_phrase(&lower, src) > 0)
            || ["'s study", "'s report", "'s survey", "'s research", "’s study", "’s report", "’s survey", "’s research"].iter().any(|m| lower.contains(m))
            || at
                .map(|a| {
                    // Within 200 characters, but only inside the claim's own paragraph.
                    let ci = full[..a].chars().count();
                    let mut lo = ci.saturating_sub(200);
                    let mut hi = (ci + s.chars().count() + 200).min(chars.len());
                    if let Some(nl) = chars[lo..ci].iter().rposition(|c| *c == '\n') {
                        lo += nl + 1;
                    }
                    let end = ci + s.chars().count();
                    if let Some(nl) = chars[end.min(hi)..hi].iter().position(|c| *c == '\n') {
                        hi = end + nl;
                    }
                    chars[lo..hi].contains(&LINK)
                })
                .unwrap_or(false);
        if cited {
            evidence.cited += 1;
        } else if evidence.uncited_examples.len() < 5 {
            evidence.uncited_examples.push(truncate_chars(&collapse_ws(&s.replace(LINK, " ")), 160));
        }
    }
    let all_words = words(&main_text);
    let numbers = all_words.iter().filter(|w| is_number(w) || w.contains('%')).count();
    evidence.stats_per_500 = (numbers as f64 * 500.0 / all_words.len().max(1) as f64 * 10.0).round() / 10.0;
    evidence.density = (((numbers + proper_nouns(&main_text)) as f64) * 100.0 / all_words.len().max(1) as f64 * 10.0).round() / 10.0;

    // Phrasing
    let lower_main = collapse_ws(&main_text.to_lowercase().replace('’', "'"));
    let per_1k = |n: usize| (n as f64 * 1000.0 / all_words.len().max(1) as f64 * 10.0).round() / 10.0;
    let hits = |list: &[&str]| -> Vec<(String, usize)> {
        let mut v: Vec<(String, usize)> = list.iter().map(|p| (p.to_string(), count_phrase(&lower_main, p))).filter(|(_, n)| *n > 0).collect();
        v.sort_by(|a, b| b.1.cmp(&a.1));
        v
    };
    let filler = hits(FILLER);
    let ai = hits(AI_PATTERNS);
    let phrasing = Phrasing {
        filler_per_1k: per_1k(filler.iter().map(|x| x.1).sum()),
        ai_per_1k: per_1k(ai.iter().map(|x| x.1).sum()),
        filler,
        ai_patterns: ai,
        em_dashes: main_text.matches('—').count(),
    };

    // Freshness
    let date = page.modified.clone().or_else(|| page.published.clone());
    let today = now_ms.map(|ms| (ms / 86_400_000.0).floor() as i64);
    let age_days = match (date.as_deref().and_then(days), today) {
        (Some(d), Some(t)) => Some((t - d).max(0)),
        _ => None,
    };
    let current_year = today.map(|t| 1970 + (t as f64 / 365.2425) as i32);
    let title_year = page
        .title
        .as_deref()
        .and_then(|t| t.split_whitespace().filter_map(is_year).max())
        .filter(|y| current_year.map(|c| *y < c).unwrap_or(false));
    let freshness = Freshness {
        tier: match age_days {
            None => "unknown",
            Some(d) if d < 91 => "excellent",
            Some(d) if d < 183 => "good",
            Some(d) if d < 365 => "acceptable",
            Some(d) if d < 730 => "warning",
            Some(_) => "stale",
        },
        date,
        age_days,
        title_year,
        vague_time: VAGUE_TIME.iter().filter(|p| count_phrase(&lower_main, p) > 0).map(|p| p.to_string()).collect(),
    };

    // Trust pages: links anywhere on the page (footers included).
    // Every anchor in the document: the page extractor caps its link list, and trust
    // links live in footers at the very end of long pages.
    let anchors: Vec<(String, String)> = doc
        .select(&sel("a[href]"))
        .map(|a| (a.value().attr("href").unwrap_or("").to_lowercase(), collapse_ws(&a.text().collect::<String>()).to_lowercase()))
        .collect();
    let same_site = |href: &str| !href.starts_with("http") || host.map(|h| href.contains(h)).unwrap_or(false);
    let any_link = |keys: &[&str]| anchors.iter().any(|(h, t)| keys.iter().any(|k| h.contains(k) || t.contains(k)));
    let has = |keys: &[&str]| anchors.iter().any(|(h, t)| same_site(h) && keys.iter().any(|k| h.contains(k) || t.contains(k)));
    let mut all_items: Vec<&SdItem> = Vec::new();
    for i in &schema.items {
        walk_items(i, &mut all_items);
    }
    let is_type = |i: &SdItem, t: &[&str]| i.types.iter().any(|x| t.contains(&short(x)));
    let trust = Trust {
        about: has(&["/about", "about us", "about-us", "who we are", "our story", ":about"]) || anchors.iter().any(|(_, t)| t == "about" || t.starts_with("about ")),
        // The page extractor skips mailto:/tel: links, so look for them in the document.
        contact: any_link(&["/contact", "contact us", "contact-us"]) || doc.select(&sel(r#"a[href^="mailto:"], a[href^="tel:"]"#)).next().is_some(),
        // Policies often live on a parent company's domain (policies.google.com, wikimedia.org).
        privacy: any_link(&["privacy"]),
        terms: any_link(&["terms", "/tos", "conditions of use", "terms of use"]),
        editorial: any_link(&["editorial", "corrections", "fact-check", "methodology", "how we test", "how we review"]),
        author_profile: all_items
            .iter()
            .any(|i| is_type(i, &["Person"]) && ["jobTitle", "worksFor", "sameAs", "alumniOf", "award", "knowsAbout"].iter().any(|k| prop(i, k).next().is_some())),
    };

    // Entity graph
    let mut same_as: Vec<String> = Vec::new();
    let mut id_refs = 0;
    let mut knows = 0;
    let mut has_entity = false;
    for i in &all_items {
        for p in &i.properties {
            for v in &p.values {
                if matches!(v, SdValue::Ref { .. }) {
                    id_refs += 1;
                }
            }
        }
        if is_type(i, &["Organization", "Corporation", "LocalBusiness", "Person", "NGO", "EducationalOrganization", "NewsMediaOrganization", "OnlineStore", "OnlineBusiness"]) {
            has_entity = true;
            for v in prop(i, "sameAs") {
                if let SdValue::Text { value } = v {
                    if !same_as.contains(value) {
                        same_as.push(value.clone());
                    }
                }
            }
            knows = knows.max(prop(i, "knowsAbout").count());
        }
    }
    let entity = EntityGraph {
        has_entity,
        id_references: id_refs,
        same_as,
        knows_about: knows,
        speakable: all_items.iter().any(|i| prop(i, "speakable").next().is_some()),
        search_action: all_items.iter().any(|i| is_type(i, &["SearchAction"])),
    };

    // GEO score; technical access is filled in from the crawler checks by the caller.
    let structure = {
        let q = if answers.question_headings == 0 { 3 } else { (answers.answered * 8 / answers.question_headings) as u32 };
        let def = if answers.early_definition { 4 } else { 0 };
        let shape = if page.lists + page.tables > 0 { 4 } else { 0 };
        let walls = passages.iter().filter(|p| p.words > 300).count();
        let paras = if walls == 0 { 4 } else { 1 };
        q + def + shape + paras
    };
    let multimodal = {
        let images = if page.image_count > 0 { if page.images_missing_alt == 0 { 6 } else { 3 } } else { 0 };
        let tables = if page.tables > 0 { 4 } else { 0 };
        let media = if page.iframes > 0 || html.contains("<video") || html.contains("<figure") { 5 } else { 0 };
        images + tables + media
    };
    let authority = {
        let mut a = 0;
        if page.author.is_some() {
            a += 4;
        }
        if trust.author_profile {
            a += 2;
        }
        a += [trust.about, trust.contact, trust.privacy].iter().filter(|x| **x).count() as u32 * 2;
        a += (entity.same_as.len() as u32).min(4);
        if evidence.claims == 0 || evidence.cited * 2 >= evidence.claims {
            a += 4;
        }
        a.min(20)
    };
    let score_parts = GeoScore {
        total: 0,
        citability: citability.score * 25 / 100,
        structure: structure.min(20),
        multimodal: multimodal.min(15),
        authority,
        technical: 0,
    };

    GeoReport { citability, answers, evidence, phrasing, freshness, trust, entity, score: score_parts }
}

/// Fill in technical access (0-20) and the total.
pub fn finish_score(g: &mut GeoScore, technical: u32) {
    g.technical = technical.min(20);
    g.total = (g.citability + g.structure + g.multimodal + g.authority + g.technical).min(100);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(html: &str) -> GeoReport {
        let page = crate::extract::extract(html, None);
        let schema = crate::schema::validate(html, None);
        analyze(html, &page, &schema, Some("ex.com"), Some(1_791_936_000_000.0)) // 2026-10-14
    }

    #[test]
    fn quotable_section_outscores_vague_one() {
        let good = "<main><h2>What is technical SEO?</h2><p>Technical SEO is the practice of making a website easy for search engines to crawl, render and index. According to Google, pages that load in under 2.5 seconds keep 24% more visitors. For example, Acme cut its load time from 4 seconds to 1.8 seconds using Cloudflare and saw 30% more organic sessions within 3 months in 2025.</p><p>First, fix crawl errors. Next, compress images. Finally, add structured data.</p></main>";
        let vague = "<main><h2>More thoughts</h2><p>But it is also really something that they think about a lot, and this is why it matters to them and to us in many ways that are hard to describe here, which is basically the point of it all, and it goes without saying that it is what it is.</p></main>";
        let g = run(good);
        let v = run(vague);
        assert!(g.citability.score > v.citability.score + 20, "{} vs {}", g.citability.score, v.citability.score);
        assert_eq!(g.answers.question_headings, 1);
        assert_eq!(g.answers.answered, 1);
        assert!(g.answers.early_definition);
        assert!(v.citability.top[0].context_dependent);
        assert!(v.phrasing.filler.iter().any(|(p, _)| p == "it goes without saying"));
    }

    #[test]
    fn claims_need_sources() {
        let html = r#"<main><p>Studies show 73% of buyers read reviews first. Most people never scroll past the fold. Forrester's study found a 3x return.</p>
          <p>A 2024 survey by <a href="https://research.example.org/x">Example Research</a> found 41% of shoppers use AI assistants.</p></main>"#;
        let g = run(html);
        assert_eq!(g.evidence.claims, 4, "{:?}", g.evidence);
        assert_eq!(g.evidence.cited, 2, "{:?}", g.evidence);
        assert!(g.evidence.uncited_examples[0].starts_with("Studies show 73%"));
    }

    #[test]
    fn lists_and_link_sections_are_not_passages() {
        let html = r#"<main><h2>For the cake</h2><ul><li>225g plain flour</li><li>350g caster sugar</li><li>85g cocoa powder</li><li>1½ tsp baking powder</li><li>2 free-range eggs</li><li>250ml milk and 125ml oil</li></ul>
          <h2>See also</h2><p><a href="https://a.org/x">Search engine marketing</a>, <a href="https://a.org/y">Link building</a>, <a href="https://a.org/z">Content marketing and more related reading for you here today</a></p>
          <h2>Method</h2><p>Heat the oven to 180C. Mix the flour, sugar and cocoa in a large bowl, then whisk in the eggs, milk and oil until the batter is smooth and glossy, which takes about two minutes by hand.</p></main>"#;
        let g = run(html);
        assert_eq!(g.citability.passages, 1, "{:?}", g.citability.top.iter().map(|p| &p.heading).collect::<Vec<_>>());
        assert_eq!(g.evidence.claims, 0, "quantities aren't claims: {:?}", g.evidence);
    }

    #[test]
    fn freshness_tiers_and_stale_title_year() {
        let html = r#"<html><head><title>Best SEO tools 2023</title><meta property="article:modified_time" content="2024-01-10T00:00:00Z"></head><body><main><p>Currently the best tools are these.</p></main></body></html>"#;
        let g = run(html);
        assert_eq!(g.freshness.tier, "stale");
        assert_eq!(g.freshness.title_year, Some(2023));
        assert_eq!(g.freshness.vague_time, vec!["currently"]);
        assert_eq!(days("1970-01-02"), Some(1));
        assert_eq!(days("2026-10-14"), Some(20740));
    }

    #[test]
    fn trust_and_entity_graph() {
        let html = r##"<body><footer><a href="/about">About</a><a href="/privacy-policy">Privacy</a><a href="mailto:hi@ex.com">Email us</a></footer>
          <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
            {"@type":"Organization","@id":"#org","name":"Ex","sameAs":["https://www.linkedin.com/company/ex","https://github.com/ex"],"knowsAbout":["SEO","Schema"]},
            {"@type":"WebSite","publisher":{"@id":"#org"},"potentialAction":{"@type":"SearchAction","target":"https://ex.com/s?q={q}","query-input":"required name=q"}}]}</script></body>"##;
        let g = run(html);
        assert!(g.trust.about && g.trust.privacy && g.trust.contact && !g.trust.terms, "{:?}", g.trust);
        assert_eq!(g.entity.same_as.len(), 2);
        assert_eq!(g.entity.id_references, 1);
        assert_eq!(g.entity.knows_about, 2);
        assert!(g.entity.search_action);
    }
}
