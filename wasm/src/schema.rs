//! Structured-data validator, in the spirit of validator.schema.org:
//!
//! * extracts items from JSON-LD, Microdata and RDFa into one tree;
//! * validates them against the schema.org vocabulary (unknown types and
//!   properties, properties used on the wrong type, value types and formats,
//!   enumeration members, superseded terms);
//! * checks Google rich-result requirements (which schema.org itself doesn't);
//! * verifies that key values are actually visible on the page (Google's
//!   guideline: markup must describe content users can see).
//!
//! The vocabulary is compiled from the schema.org release by
//! scripts/build-schema-vocab.mjs into schema_vocab.json.

use crate::extract::collapse_ws;
use scraper::{ElementRef, Html, Node, Selector};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::OnceLock;

// ------------------------------------------------------------------ vocabulary

#[derive(Deserialize)]
struct RawProp {
    d: Vec<String>,
    r: Vec<String>,
    s: Option<String>,
}

#[derive(Deserialize)]
struct RawVocab {
    v: String,
    c: HashMap<String, Vec<String>>,
    p: HashMap<String, RawProp>,
    m: HashMap<String, String>,
    s: HashMap<String, String>,
    dt: Vec<String>,
}

struct Vocab {
    version: String,
    classes: HashMap<String, Vec<String>>,
    props: HashMap<String, RawProp>,
    members: HashMap<String, String>,
    superseded: HashMap<String, String>,
    data_types: HashSet<String>,
    lower_classes: HashMap<String, String>,
    lower_props: HashMap<String, String>,
}

fn vocab() -> &'static Vocab {
    static V: OnceLock<Vocab> = OnceLock::new();
    V.get_or_init(|| {
        let raw: RawVocab = serde_json::from_str(include_str!("schema_vocab.json")).expect("valid schema vocab");
        Vocab {
            lower_classes: raw.c.keys().map(|k| (k.to_lowercase(), k.clone())).collect(),
            lower_props: raw.p.keys().map(|k| (k.to_lowercase(), k.clone())).collect(),
            version: raw.v,
            classes: raw.c,
            props: raw.p,
            members: raw.m,
            superseded: raw.s,
            data_types: raw.dt.into_iter().collect(),
        }
    })
}

impl Vocab {
    /// The type and all its ancestors.
    fn lineage(&self, t: &str) -> HashSet<String> {
        let mut out = HashSet::new();
        let mut q = VecDeque::from([t.to_string()]);
        while let Some(x) = q.pop_front() {
            if out.insert(x.clone()) {
                if let Some(ps) = self.classes.get(&x) {
                    q.extend(ps.iter().cloned());
                }
            }
        }
        out
    }

    fn is_enumeration(&self, t: &str) -> bool {
        self.lineage(t).contains("Enumeration")
    }

    fn suggest(&self, name: &str, class: bool) -> Option<String> {
        let lower = name.to_lowercase();
        let exact = if class { self.lower_classes.get(&lower) } else { self.lower_props.get(&lower) };
        if let Some(e) = exact {
            return Some(e.clone());
        }
        let pool: Box<dyn Iterator<Item = &String>> = if class { Box::new(self.classes.keys()) } else { Box::new(self.props.keys()) };
        let max = (name.len() / 4).clamp(1, 3);
        pool.map(|k| (edit_distance(&lower, &k.to_lowercase()), k))
            .filter(|(d, _)| *d <= max)
            .min_by(|a, b| a.0.cmp(&b.0).then(a.1.len().cmp(&b.1.len())))
            .map(|(_, k)| k.clone())
    }
}

/// Edit distance where swapping two adjacent letters counts as one edit
/// (optimal string alignment), so "Prodcut" and "nmae" find their fixes.
fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut d = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for j in 0..=b.len() {
        d[0][j] = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            d[i][j] = (d[i - 1][j] + 1).min(d[i][j - 1] + 1).min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                d[i][j] = d[i][j].min(d[i - 2][j - 2] + 1);
            }
        }
    }
    d[a.len()][b.len()]
}

pub fn vocab_version() -> &'static str {
    &vocab().version
}

// ------------------------------------------------------------------ model

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub severity: &'static str,
    pub message: String,
}

fn error(m: impl Into<String>) -> Issue {
    Issue { severity: "error", message: m.into() }
}
fn warning(m: impl Into<String>) -> Issue {
    Issue { severity: "warning", message: m.into() }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SdValue {
    Text { value: String },
    Item { item: Box<SdItem> },
    Ref { id: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdProp {
    pub name: String,
    pub values: Vec<SdValue>,
    pub issues: Vec<Issue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdItem {
    pub format: &'static str,
    pub types: Vec<String>,
    pub id: Option<String>,
    pub properties: Vec<SdProp>,
    pub issues: Vec<Issue>,
    /// Errors and warnings in this item and everything nested in it.
    pub errors: usize,
    pub warnings: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RichResult {
    pub feature: &'static str,
    pub item_type: String,
    /// "eligible", "invalid" (missing required), "limited" or "deprecated".
    pub status: &'static str,
    pub missing_required: Vec<String>,
    pub missing_recommended: Vec<String>,
    pub note: Option<&'static str>,
    pub docs: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibilityIssue {
    pub item_type: String,
    pub property: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaReport {
    pub vocab_version: String,
    pub items: Vec<SdItem>,
    pub errors: usize,
    pub warnings: usize,
    pub formats: Vec<(String, usize)>,
    pub rich_results: Vec<RichResult>,
    pub not_visible: Vec<VisibilityIssue>,
    /// JSON-LD blocks that aren't valid JSON (nothing can be read from them).
    pub syntax_errors: Vec<String>,
}

// ------------------------------------------------------------------ extraction: JSON-LD

fn strip_ns(s: &str) -> Option<String> {
    let s = s.trim();
    for p in ["https://schema.org/", "http://schema.org/", "schema:", "https://www.schema.org/", "http://www.schema.org/"] {
        if let Some(rest) = s.strip_prefix(p) {
            return Some(rest.trim_end_matches('/').to_string());
        }
    }
    if s.contains(':') || s.contains('/') {
        None
    } else {
        Some(s.to_string())
    }
}

fn context_issue(ctx: Option<&Value>) -> Option<Issue> {
    let ok = |s: &str| matches!(s.trim_end_matches('/'), "https://schema.org" | "http://schema.org" | "https://www.schema.org" | "http://www.schema.org");
    match ctx {
        None => Some(error("Missing @context. Without \"@context\": \"https://schema.org\" the properties aren't schema.org terms.")),
        Some(Value::String(s)) if ok(s) => None,
        Some(Value::Object(m)) if m.get("@vocab").and_then(Value::as_str).map(ok).unwrap_or(false) => None,
        Some(Value::Array(a)) if a.iter().any(|x| x.as_str().map(ok).unwrap_or(false) || x.get("@vocab").and_then(Value::as_str).map(ok).unwrap_or(false)) => None,
        Some(other) => Some(warning(format!("@context is {other}, not schema.org; these terms may not be read as schema.org."))),
    }
}

fn jsonld_item(v: &Value, inherited_ctx: Option<&Value>, top: bool) -> Option<SdItem> {
    let obj = v.as_object()?;
    let mut issues = Vec::new();
    if top {
        if let Some(i) = context_issue(obj.get("@context").or(inherited_ctx)) {
            issues.push(i);
        }
    }
    let types: Vec<String> = match obj.get("@type") {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a.iter().filter_map(|t| t.as_str().map(String::from)).collect(),
        _ => vec![],
    };
    let mut properties = Vec::new();
    for (k, val) in obj {
        if k.starts_with('@') {
            continue;
        }
        let vals: Vec<&Value> = match val {
            Value::Array(a) => a.iter().collect(),
            other => vec![other],
        };
        let values = vals
            .into_iter()
            .filter_map(|x| match x {
                Value::Object(m) if m.contains_key("@value") => Some(SdValue::Text { value: scalar(&m["@value"]) }),
                Value::Object(m) if m.len() == 1 && m.contains_key("@id") => Some(SdValue::Ref { id: scalar(&m["@id"]) }),
                Value::Object(_) => jsonld_item(x, None, false).map(|i| SdValue::Item { item: Box::new(i) }),
                Value::Null => None,
                other => Some(SdValue::Text { value: scalar(other) }),
            })
            .collect();
        properties.push(SdProp { name: k.clone(), values, issues: vec![] });
    }
    Some(SdItem {
        format: "JSON-LD",
        types,
        id: obj.get("@id").map(scalar),
        properties,
        issues,
        errors: 0,
        warnings: 0,
    })
}

fn scalar(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn jsonld_items(root: &Value, out: &mut Vec<SdItem>) {
    match root {
        Value::Array(a) => a.iter().for_each(|x| jsonld_items(x, out)),
        Value::Object(m) => {
            if let Some(graph) = m.get("@graph") {
                let ctx = m.get("@context");
                let nodes: Vec<&Value> = match graph {
                    Value::Array(a) => a.iter().collect(),
                    other => vec![other],
                };
                for n in nodes {
                    let has_own = n.get("@context").is_some();
                    if let Some(i) = jsonld_item(n, if has_own { None } else { ctx }, true) {
                        out.push(i);
                    }
                }
            } else if let Some(i) = jsonld_item(root, None, true) {
                out.push(i);
            }
        }
        _ => {}
    }
}

// ------------------------------------------------------------------ extraction: Microdata & RDFa

fn sel(s: &str) -> Selector {
    Selector::parse(s).expect("static selector")
}

fn text_value(el: &ElementRef, attr_for_value: &[&str]) -> String {
    let v = el.value();
    for a in attr_for_value {
        if let Some(x) = v.attr(a) {
            return x.trim().to_string();
        }
    }
    let by_tag = match v.name() {
        "meta" => v.attr("content"),
        "a" | "link" | "area" => v.attr("href"),
        "img" | "audio" | "video" | "source" | "iframe" | "embed" | "track" => v.attr("src"),
        "object" => v.attr("data"),
        "time" => v.attr("datetime"),
        "data" | "meter" => v.attr("value"),
        _ => None,
    };
    by_tag.map(|s| s.trim().to_string()).unwrap_or_else(|| collapse_ws(&el.text().collect::<String>()))
}

/// Nearest ancestor element carrying `scope_attr` (itemscope / typeof).
fn owner<'a>(el: &ElementRef<'a>, scope_attr: &str) -> Option<ElementRef<'a>> {
    el.ancestors().filter_map(ElementRef::wrap).find(|a| a.value().attr(scope_attr).is_some())
}

fn microdata_item(el: ElementRef) -> SdItem {
    let types: Vec<String> = el.value().attr("itemtype").map(|t| t.split_whitespace().map(String::from).collect()).unwrap_or_default();
    let mut props: Vec<SdProp> = Vec::new();
    for d in el.descendants().filter_map(ElementRef::wrap) {
        let Some(names) = d.value().attr("itemprop") else { continue };
        if owner(&d, "itemscope").map(|o| o.id()) != Some(el.id()) {
            continue;
        }
        let value = if d.value().attr("itemscope").is_some() {
            SdValue::Item { item: Box::new(microdata_item(d)) }
        } else {
            SdValue::Text { value: text_value(&d, &[]) }
        };
        for n in names.split_whitespace() {
            match props.iter_mut().find(|p| p.name == n) {
                Some(p) => p.values.push(value.clone()),
                None => props.push(SdProp { name: n.to_string(), values: vec![value.clone()], issues: vec![] }),
            }
        }
    }
    SdItem { format: "Microdata", types, id: el.value().attr("itemid").map(String::from), properties: props, issues: vec![], errors: 0, warnings: 0 }
}

/// RDFa `typeof` terms that resolve to schema.org: full URLs, `schema:` CURIEs,
/// or bare terms under a schema.org `vocab`. Other vocabularies (MediaWiki's
/// `mw:`, Dublin Core, Open Graph...) aren't schema.org items.
fn rdfa_types(el: &ElementRef) -> Vec<String> {
    let schema_vocab = std::iter::once(*el)
        .chain(el.ancestors().filter_map(ElementRef::wrap))
        .find_map(|a| a.value().attr("vocab"))
        .map(|v| v.contains("schema.org"))
        .unwrap_or(false);
    el.value()
        .attr("typeof")
        .unwrap_or("")
        .split_whitespace()
        .filter_map(|t| {
            if t.contains("schema.org/") || t.starts_with("schema:") {
                Some(t.to_string())
            } else if !t.contains(':') && !t.contains('/') && schema_vocab {
                Some(format!("https://schema.org/{t}"))
            } else {
                None
            }
        })
        .collect()
}

fn rdfa_item(el: ElementRef) -> SdItem {
    let types = rdfa_types(&el);
    let mut props: Vec<SdProp> = Vec::new();
    for d in el.descendants().filter_map(ElementRef::wrap) {
        let Some(names) = d.value().attr("property") else { continue };
        if owner(&d, "typeof").map(|o| o.id()) != Some(el.id()) {
            continue;
        }
        let value = if d.value().attr("typeof").is_some() {
            SdValue::Item { item: Box::new(rdfa_item(d)) }
        } else {
            SdValue::Text { value: text_value(&d, &["content", "resource"]) }
        };
        for n in names.split_whitespace() {
            match props.iter_mut().find(|p| p.name == n) {
                Some(p) => p.values.push(value.clone()),
                None => props.push(SdProp { name: n.to_string(), values: vec![value.clone()], issues: vec![] }),
            }
        }
    }
    SdItem { format: "RDFa", types, id: el.value().attr("resource").map(String::from), properties: props, issues: vec![], errors: 0, warnings: 0 }
}

// ------------------------------------------------------------------ validation

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 10 || !(b[..4].iter().all(u8::is_ascii_digit) && b[4] == b'-' && b[5..7].iter().all(u8::is_ascii_digit) && b[7] == b'-' && b[8..10].iter().all(u8::is_ascii_digit)) {
        return false;
    }
    let num = |r: std::ops::Range<usize>| s[r].parse::<u32>().unwrap_or(0);
    let (y, m, d) = (num(0..4), num(5..7), num(8..10));
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&d)
}
fn is_datetime(s: &str) -> bool {
    is_date(s) && (s.len() == 10 || (matches!(s.as_bytes().get(10), Some(b'T') | Some(b' ')) && is_time(&s[11..])))
}
fn is_time(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 5 && b[..2].iter().all(u8::is_ascii_digit) && b[2] == b':' && b[3..5].iter().all(u8::is_ascii_digit)
}
fn is_number(s: &str) -> bool {
    let t = s.trim();
    !t.is_empty() && t.replace([',', ' '], "").parse::<f64>().is_ok()
}
fn is_url(s: &str) -> bool {
    let t = s.trim();
    t.starts_with("http://") || t.starts_with("https://") || t.starts_with('/') || t.starts_with("//") || t.starts_with("data:")
}
fn is_duration(s: &str) -> bool {
    let t = s.trim();
    t.starts_with('P') && t.len() > 1 && t[1..].chars().all(|c| c.is_ascii_digit() || "YMWDTHS.".contains(c))
}

fn format_ok(dt: &str, v: &str) -> bool {
    match dt {
        "Date" => is_date(v),
        "DateTime" => is_datetime(v),
        "Time" => is_time(v),
        "Number" | "Float" => is_number(v),
        "Integer" => v.trim().parse::<i64>().is_ok(),
        "Boolean" => matches!(v.trim().trim_start_matches("https://schema.org/").trim_start_matches("http://schema.org/").to_lowercase().as_str(), "true" | "false"),
        "URL" => is_url(v),
        "Duration" => is_duration(v),
        _ => true, // Text, PronounceableText, Quantity family, selectors
    }
}

/// Properties where Google needs an object, not plain text, for rich results.
const OBJECT_EXPECTED: &[&str] = &["offers", "aggregateRating", "review", "reviewRating", "address", "location", "itemListElement", "mainEntity", "acceptedAnswer", "hiringOrganization", "jobLocation", "geo", "openingHoursSpecification", "publisher"];

struct Ctx<'a> {
    by_id: &'a HashMap<String, Vec<String>>,
}

fn validate_item(item: &mut SdItem, cx: &Ctx, top: bool) {
    let v = vocab();
    // Types
    let mut known: Vec<String> = Vec::new();
    for raw in item.types.clone() {
        match strip_ns(&raw) {
            None => item.issues.push(warning(format!("The type {raw} isn't from schema.org, so it can't be validated here."))),
            Some(t) if v.classes.contains_key(&t) && !v.data_types.contains(&t) => {
                if let Some(new) = v.superseded.get(&t) {
                    item.issues.push(warning(format!("The type {t} is superseded by {new}.")));
                }
                known.push(t);
            }
            Some(t) if v.props.contains_key(&t) => item.issues.push(error(format!("{t} is a schema.org property, not a type."))),
            Some(t) => {
                let hint = v.suggest(&t, true).map(|s| format!(" Did you mean {s}?")).unwrap_or_default();
                item.issues.push(error(format!("{t} is not a schema.org type.{hint}")));
            }
        }
    }
    let wraps_items = item.properties.iter().flat_map(|p| p.values.iter()).any(|v| matches!(v, SdValue::Item { .. }));
    if item.types.is_empty() && top && wraps_items {
        item.issues.push(warning("This object has no @type, so it describes nothing itself; only the typed items inside it are read. Move its properties onto the item they belong to."));
    } else if item.types.is_empty() && top {
        item.issues.push(error("Missing @type: consumers can't tell what this item describes."));
    }
    let lineage: HashSet<String> = known.iter().flat_map(|t| v.lineage(t)).collect();

    for prop in item.properties.iter_mut() {
        let name = match strip_ns(&prop.name) {
            Some(n) => n,
            None => {
                prop.issues.push(warning(format!("{} isn't a schema.org property.", prop.name)));
                continue;
            }
        };
        // Action annotations (query-input, target-output) are part of schema.org's Actions model.
        if let Some(base) = name.strip_suffix("-input").or_else(|| name.strip_suffix("-output")) {
            if v.props.contains_key(base) {
                continue;
            }
        }
        let Some(def) = v.props.get(&name) else {
            let hint = v.suggest(&name, false).map(|s| format!(" Did you mean {s}?")).unwrap_or_default();
            prop.issues.push(error(format!("{name} is not a schema.org property.{hint}")));
            for val in prop.values.iter_mut() {
                if let SdValue::Item { item } = val {
                    validate_item(item, cx, false);
                }
            }
            continue;
        };
        if let Some(new) = &def.s {
            prop.issues.push(warning(format!("{name} is superseded by {new}.")));
        }
        if !known.is_empty() && !def.d.is_empty() && !def.d.iter().any(|d| lineage.contains(d)) {
            prop.issues.push(warning(format!(
                "The property {name} is not recognized by schema.org for an object of type {}. It applies to: {}.",
                known.join(", "),
                def.d.iter().take(6).cloned().collect::<Vec<_>>().join(", ")
            )));
        }

        let ranges = &def.r;
        let range_lineage = |types: &[String]| -> bool {
            types.iter().filter_map(|t| strip_ns(t)).any(|t| v.lineage(&t).iter().any(|a| ranges.contains(a))) || ranges.iter().any(|r| r == "Thing")
        };
        let data: Vec<&String> = ranges.iter().filter(|r| v.data_types.contains(*r)).collect();
        let enums: Vec<&String> = ranges.iter().filter(|r| v.is_enumeration(r)).collect();
        let takes_text = ranges.iter().any(|r| matches!(r.as_str(), "Text" | "PronounceableText" | "CssSelectorType" | "XPathType"));

        for val in prop.values.iter_mut() {
            match val {
                SdValue::Item { item: child } => {
                    let child_types: Vec<String> = child.types.iter().filter_map(|t| strip_ns(t)).collect();
                    if !child_types.is_empty() && !range_lineage(&child_types) && v.classes.contains_key(&child_types[0]) {
                        prop.issues.push(warning(format!("{name} expects {}; got {}.", ranges.join(" or "), child_types.join(", "))));
                    }
                    validate_item(child, cx, false);
                }
                SdValue::Ref { id } => {
                    if let Some(types) = cx.by_id.get(id.as_str()) {
                        if !types.is_empty() && !range_lineage(types) {
                            prop.issues.push(warning(format!("{name} expects {}; the referenced {id} is a {}.", ranges.join(" or "), types.join(", "))));
                        }
                    }
                }
                SdValue::Text { value } => {
                    let t = value.trim();
                    if t.is_empty() {
                        prop.issues.push(warning(format!("{name} is empty.")));
                        continue;
                    }
                    // Enumeration members (InStock, https://schema.org/InStock).
                    if !enums.is_empty() && data.is_empty() {
                        let member = strip_ns(t).unwrap_or_default();
                        match v.members.get(&member) {
                            Some(cls) if enums.iter().any(|e| v.lineage(cls).contains(*e)) => {}
                            _ => {
                                let examples: Vec<&String> = v.members.iter().filter(|(_, c)| enums.contains(c)).map(|(m, _)| m).take(4).collect();
                                prop.issues.push(error(format!(
                                    "{name} expects one of the {} values, such as {}; got \"{t}\".",
                                    enums.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(" or "),
                                    examples.iter().map(|e| format!("https://schema.org/{e}")).collect::<Vec<_>>().join(", ")
                                )));
                            }
                        }
                        continue;
                    }
                    if !data.is_empty() && !takes_text && !data.iter().any(|d| format_ok(d, t)) {
                        let fmt = data
                            .iter()
                            .map(|d| match d.as_str() {
                                "Date" => "a Date (YYYY-MM-DD)".to_string(),
                                "DateTime" => "a DateTime (ISO 8601, e.g. 2025-06-01T09:00:00Z)".to_string(),
                                "Duration" => "a Duration (ISO 8601, e.g. PT1H30M)".to_string(),
                                "URL" => "a URL".to_string(),
                                other if other.starts_with(['A', 'E', 'I', 'O', 'U']) => format!("an {other}"),
                                other => format!("a {other}"),
                            })
                            .collect::<Vec<_>>()
                            .join(" or ");
                        prop.issues.push(error(format!("{name} expects {fmt}; got \"{}\".", crate::extract::truncate_chars(t, 60))));
                    } else if data.is_empty() && OBJECT_EXPECTED.contains(&name.as_str()) && !is_url(t) {
                        prop.issues.push(warning(format!("{name} is plain text; search engines need a {} object here for rich results.", ranges.join(" or "))));
                    }
                }
            }
        }
    }
}

fn tally(item: &mut SdItem) -> (usize, usize) {
    let mut e = item.issues.iter().filter(|i| i.severity == "error").count();
    let mut w = item.issues.iter().filter(|i| i.severity == "warning").count();
    for p in item.properties.iter_mut() {
        e += p.issues.iter().filter(|i| i.severity == "error").count();
        w += p.issues.iter().filter(|i| i.severity == "warning").count();
        for val in p.values.iter_mut() {
            if let SdValue::Item { item: child } = val {
                let (ce, cw) = tally(child);
                e += ce;
                w += cw;
            }
        }
    }
    item.errors = e;
    item.warnings = w;
    (e, w)
}

// ------------------------------------------------------------------ Google rich results

struct Feature {
    name: &'static str,
    types: &'static [&'static str],
    required: &'static [&'static str],
    recommended: &'static [&'static str],
    status: &'static str,
    note: Option<&'static str>,
    docs: &'static str,
}

/// `a|b` = either; `x.y` = nested property.
const FEATURES: &[Feature] = &[
    Feature { name: "Article", types: &["Article", "NewsArticle", "BlogPosting"], required: &[], recommended: &["headline", "image", "datePublished", "dateModified", "author", "author.name"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/article" },
    Feature { name: "Breadcrumb", types: &["BreadcrumbList"], required: &["itemListElement", "itemListElement.position", "itemListElement.name"], recommended: &[], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/breadcrumb" },
    Feature { name: "Product variants", types: &["ProductGroup"], required: &["name", "hasVariant"], recommended: &["productGroupID", "variesBy", "brand", "description", "hasVariant.offers", "hasVariant.image"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/product-variants" },
    Feature { name: "Product snippet", types: &["Product"], required: &["name", "offers|review|aggregateRating"], recommended: &["image", "description", "brand", "sku", "offers.price", "offers.priceCurrency", "offers.availability"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/product-snippet" },
    Feature { name: "Review snippet", types: &["Review"], required: &["author", "reviewRating", "reviewRating.ratingValue"], recommended: &["itemReviewed", "datePublished"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/review-snippet" },
    Feature { name: "Review snippet (aggregate)", types: &["AggregateRating"], required: &["ratingValue", "ratingCount|reviewCount"], recommended: &["bestRating", "worstRating"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/review-snippet" },
    Feature { name: "FAQ", types: &["FAQPage"], required: &["mainEntity", "mainEntity.name", "mainEntity.acceptedAnswer"], recommended: &[], status: "limited", note: Some("Google shows FAQ rich results only for well-known authoritative government and health sites (since August 2023)."), docs: "https://developers.google.com/search/docs/appearance/structured-data/faqpage" },
    Feature { name: "How-to", types: &["HowTo"], required: &["name", "step"], recommended: &[], status: "deprecated", note: Some("Google retired How-to rich results in September 2023. The markup is still valid schema.org."), docs: "https://developers.google.com/search/docs/appearance/structured-data/how-to" },
    Feature { name: "Recipe", types: &["Recipe"], required: &["name", "image"], recommended: &["author", "datePublished", "description", "prepTime", "cookTime", "totalTime", "recipeYield", "recipeIngredient", "recipeInstructions", "aggregateRating", "nutrition.calories"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/recipe" },
    Feature { name: "Event", types: &["Event"], required: &["name", "startDate", "location"], recommended: &["description", "endDate", "eventStatus", "eventAttendanceMode", "image", "offers", "organizer", "performer"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/event" },
    Feature { name: "Job posting", types: &["JobPosting"], required: &["title", "description", "datePosted", "hiringOrganization", "jobLocation|applicantLocationRequirements"], recommended: &["validThrough", "employmentType", "baseSalary", "identifier", "directApply"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/job-posting" },
    Feature { name: "Local business", types: &["LocalBusiness"], required: &["name", "address"], recommended: &["telephone", "url", "geo", "openingHoursSpecification", "priceRange", "image", "aggregateRating"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/local-business" },
    Feature { name: "Organization", types: &["Organization"], required: &[], recommended: &["name", "url", "logo", "sameAs", "description", "address", "contactPoint"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/organization" },
    Feature { name: "Video", types: &["VideoObject"], required: &["name", "thumbnailUrl", "uploadDate"], recommended: &["description", "contentUrl", "embedUrl", "duration"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/video" },
    Feature { name: "Software app", types: &["SoftwareApplication"], required: &["name", "offers|aggregateRating|review"], recommended: &["applicationCategory", "operatingSystem", "offers.price"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/software-app" },
    Feature { name: "Course", types: &["Course"], required: &["name", "description"], recommended: &["provider", "offers", "hasCourseInstance"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/course" },
    Feature { name: "Dataset", types: &["Dataset"], required: &["name", "description"], recommended: &["url", "license", "creator", "identifier", "keywords"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/dataset" },
    Feature { name: "Discussion forum", types: &["DiscussionForumPosting"], required: &["author", "datePublished", "text|image|video"], recommended: &["headline", "url", "comment"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/discussion-forum" },
    Feature { name: "Profile page", types: &["ProfilePage"], required: &["mainEntity", "mainEntity.name"], recommended: &["dateCreated", "dateModified"], status: "eligible", note: None, docs: "https://developers.google.com/search/docs/appearance/structured-data/profile-page" },
];

fn prop_values<'a>(item: &'a SdItem, name: &str) -> Vec<&'a SdValue> {
    item.properties.iter().filter(|p| strip_ns(&p.name).as_deref() == Some(name)).flat_map(|p| p.values.iter()).collect()
}

fn has_path(item: &SdItem, path: &str, by_id: &HashMap<String, &SdItem>) -> bool {
    path.split('|').any(|alt| {
        let mut parts = alt.split('.');
        let first = parts.next().unwrap_or("");
        let rest: Vec<&str> = parts.collect();
        let vals = prop_values(item, first);
        if rest.is_empty() {
            return vals.iter().any(|v| !matches!(v, SdValue::Text { value } if value.trim().is_empty()));
        }
        vals.iter().any(|v| match v {
            SdValue::Item { item: child } => has_path(child, &rest.join("."), by_id),
            SdValue::Ref { id } => by_id.get(id.as_str()).map(|c| has_path(c, &rest.join("."), by_id)).unwrap_or(false),
            _ => false,
        })
    })
}

fn walk<'a>(item: &'a SdItem, out: &mut Vec<&'a SdItem>) {
    out.push(item);
    for p in &item.properties {
        for v in &p.values {
            if let SdValue::Item { item: c } = v {
                walk(c, out);
            }
        }
    }
}

/// The items a page is "about": top-level items, plus the typed children of a
/// typeless wrapper object. Nested items (variants, authors, ratings) are
/// judged as part of their parent, as Google does.
fn primary_items(items: &[SdItem]) -> Vec<&SdItem> {
    let mut out = Vec::new();
    for i in items {
        if i.types.is_empty() {
            for p in &i.properties {
                for v in &p.values {
                    if let SdValue::Item { item } = v {
                        out.push(item.as_ref());
                    }
                }
            }
        } else {
            out.push(i);
        }
    }
    out
}

fn rich_results(items: &[SdItem]) -> Vec<RichResult> {
    let v = vocab();
    let mut all = Vec::new();
    for i in items {
        walk(i, &mut all);
    }
    let by_id: HashMap<String, &SdItem> = all.iter().filter_map(|i| i.id.clone().map(|id| (id, *i))).collect();
    let mut out: Vec<RichResult> = Vec::new();
    for item in primary_items(items) {
        // Without a schema.org @context, Google doesn't read the item at all.
        if item.issues.iter().any(|i| i.message.starts_with("Missing @context")) {
            continue;
        }
        let types: Vec<String> = item.types.iter().filter_map(|t| strip_ns(t)).collect();
        let lineage: HashSet<String> = types.iter().flat_map(|t| v.lineage(t)).collect();
        // Every feature the item names directly (a Recipe + NewsArticle is both); otherwise the
        // most specific one it inherits (a Restaurant is a Local business, not just an Organization).
        let mut features: Vec<&Feature> = FEATURES.iter().filter(|f| f.types.iter().any(|t| types.iter().any(|x| x == t))).collect();
        if features.is_empty() {
            features.extend(FEATURES.iter().find(|f| f.types.iter().any(|t| lineage.contains(*t))));
        }
        for f in features {
        let missing_required: Vec<String> = f.required.iter().filter(|p| !has_path(item, p, &by_id)).map(|p| p.replace('|', " or ")).collect();
        let missing_recommended: Vec<String> = f.recommended.iter().filter(|p| !has_path(item, p, &by_id)).map(|p| p.replace('|', " or ")).collect();
        let status = if f.status != "eligible" { f.status } else if missing_required.is_empty() { "eligible" } else { "invalid" };
        out.push(RichResult { feature: f.name, item_type: types.join(", "), status, missing_required, missing_recommended, note: f.note, docs: f.docs });
        }
    }
    out
}

// ------------------------------------------------------------------ visible-content verifier

const VISIBLE_PROPS: &[&str] = &["name", "headline", "price", "ratingValue", "reviewCount", "ratingCount"];

fn norm_text(s: &str) -> String {
    collapse_ws(&s.to_lowercase().replace(['\u{a0}', '\u{2019}', '’'], " "))
}

/// Site-level entities and page furniture: their names needn't be in the page text.
const NOT_CONTENT: &[&str] = &["Organization", "WebSite", "Person", "ImageObject", "WebPage", "SearchAction", "EntryPoint", "Brand", "BreadcrumbList", "SiteNavigationElement", "WPHeader", "WPFooter", "ItemList"];

/// "1,299.00" → "1299", "4.60" → "4.6", "9951" → "9951".
fn norm_number(s: &str) -> String {
    let n: String = s.trim_matches(|c: char| c == '.' || c == ',').chars().filter(|c| *c != ',' && *c != ' ').collect();
    if n.parse::<f64>().is_err() {
        return String::new();
    }
    if n.contains('.') {
        n.trim_end_matches('0').trim_end_matches('.').to_string()
    } else {
        n
    }
}

fn words(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric()).filter(|w| w.chars().count() >= 3).map(String::from).collect()
}

fn verify_visible(items: &[SdItem], visible: &str) -> Vec<VisibilityIssue> {
    let page = norm_text(visible);
    let page_words: HashSet<String> = words(&page).into_iter().collect();
    let page_numbers: HashSet<String> = page
        .split(|c: char| !(c.is_ascii_digit() || c == '.' || c == ','))
        .map(norm_number)
        .filter(|n| !n.is_empty())
        .collect();
    let v = vocab();
    // Primary items and the offers/ratings directly attached to them.
    let mut targets: Vec<&SdItem> = Vec::new();
    for item in primary_items(items) {
        targets.push(item);
        for p in &item.properties {
            if matches!(strip_ns(&p.name).as_deref(), Some("offers" | "aggregateRating")) {
                targets.extend(p.values.iter().filter_map(|x| if let SdValue::Item { item } = x { Some(item.as_ref()) } else { None }));
            }
        }
    }
    let mut out = Vec::new();
    for item in targets {
        let types: Vec<String> = item.types.iter().filter_map(|t| strip_ns(t)).collect();
        let ty = types.first().cloned().unwrap_or_else(|| "Thing".into());
        if types.iter().any(|t| v.lineage(t).iter().any(|a| NOT_CONTENT.contains(&a.as_str()))) {
            continue;
        }
        for p in &item.properties {
            let Some(name) = strip_ns(&p.name) else { continue };
            if !VISIBLE_PROPS.contains(&name.as_str()) {
                continue;
            }
            for val in &p.values {
                let SdValue::Text { value } = val else { continue };
                let t = norm_text(value);
                let numeric = matches!(name.as_str(), "price" | "ratingValue" | "reviewCount" | "ratingCount");
                if t.is_empty() || (!numeric && t.chars().count() < 2) {
                    continue;
                }
                let found = if numeric {
                    let n = norm_number(&t);
                    page_numbers.contains(&n)
                        // Ratings are shown rounded (3.6902 → "3.7 out of 5").
                        || (name == "ratingValue"
                            && n.parse::<f64>().is_ok_and(|x| page_numbers.iter().filter_map(|p| p.parse::<f64>().ok()).any(|p| (p - x).abs() < 0.05 + f64::EPSILON)))
                } else if page.contains(&t) {
                    true
                } else {
                    // Wording differs slightly (punctuation, "| Brand" suffixes): most words must still be on the page.
                    let w = words(&t);
                    !w.is_empty() && w.iter().filter(|x| page_words.contains(*x)).count() * 5 >= w.len() * 4
                };
                if !found {
                    out.push(VisibilityIssue { item_type: ty.clone(), property: name.clone(), value: crate::extract::truncate_chars(value, 120) });
                }
            }
        }
    }
    out
}

// ------------------------------------------------------------------ entry point

/// Validate every structured-data item in `html`. `visible_text` (the page's
/// rendered text) enables the visible-content verifier.
pub fn validate(html: &str, visible_text: Option<&str>) -> SchemaReport {
    let doc = Html::parse_document(html);
    let mut items: Vec<SdItem> = Vec::new();
    let mut syntax_errors = Vec::new();

    for s in doc.select(&sel(r#"script[type="application/ld+json"]"#)) {
        let raw: String = s.text().collect();
        let cleaned = raw.trim().trim_start_matches("<!--").trim_end_matches("-->").trim();
        match serde_json::from_str::<Value>(cleaned) {
            Ok(v) => jsonld_items(&v, &mut items),
            Err(e) => syntax_errors.push(format!("JSON-LD syntax error: {e}")),
        }
    }
    for el in doc.select(&sel("[itemscope]")) {
        if el.value().attr("itemprop").is_none() || owner(&el, "itemscope").is_none() {
            items.push(microdata_item(el));
        }
    }
    for el in doc.select(&sel("[typeof]")) {
        if (el.value().attr("property").is_none() || owner(&el, "typeof").is_none()) && !rdfa_types(&el).is_empty() {
            items.push(rdfa_item(el));
        }
    }

    let mut by_id_types: HashMap<String, Vec<String>> = HashMap::new();
    fn collect_ids(i: &SdItem, out: &mut HashMap<String, Vec<String>>) {
        if let Some(id) = &i.id {
            out.insert(id.clone(), i.types.iter().filter_map(|t| strip_ns(t)).collect());
        }
        for p in &i.properties {
            for v in &p.values {
                if let SdValue::Item { item } = v {
                    collect_ids(item, out);
                }
            }
        }
    }
    for i in &items {
        collect_ids(i, &mut by_id_types);
    }
    let cx = Ctx { by_id: &by_id_types };
    for i in items.iter_mut() {
        validate_item(i, &cx, true);
        tally(i);
    }

    let mut formats: Vec<(String, usize)> = Vec::new();
    for f in ["JSON-LD", "Microdata", "RDFa"] {
        let n = items.iter().filter(|i| i.format == f).count();
        if n > 0 {
            formats.push((f.to_string(), n));
        }
    }
    let rich = rich_results(&items);
    let not_visible = visible_text.map(|t| verify_visible(&items, t)).unwrap_or_default();
    SchemaReport {
        vocab_version: vocab().version.clone(),
        errors: items.iter().map(|i| i.errors).sum::<usize>() + syntax_errors.len(),
        warnings: items.iter().map(|i| i.warnings).sum(),
        items,
        formats,
        rich_results: rich,
        not_visible,
        syntax_errors,
    }
}

/// Visible text for the verifier: the whole body, scripts and styles excluded.
pub fn visible_text(html: &str) -> String {
    let doc = Html::parse_document(html);
    let mut out = String::new();
    fn go(el: ElementRef, out: &mut String) {
        for c in el.children() {
            match c.value() {
                Node::Text(t) => {
                    out.push_str(t);
                    out.push(' ');
                }
                Node::Element(e) if !matches!(e.name(), "script" | "style" | "noscript" | "template" | "svg") => {
                    if let Some(ce) = ElementRef::wrap(c) {
                        go(ce, out);
                    }
                }
                _ => {}
            }
        }
    }
    if let Some(body) = doc.select(&sel("body")).next() {
        go(body, &mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issues(r: &SchemaReport) -> Vec<String> {
        fn go(i: &SdItem, out: &mut Vec<String>) {
            out.extend(i.issues.iter().map(|x| format!("{}: {}", x.severity, x.message)));
            for p in &i.properties {
                out.extend(p.issues.iter().map(|x| format!("{}: {}", x.severity, x.message)));
                for v in &p.values {
                    if let SdValue::Item { item } = v {
                        go(item, out);
                    }
                }
            }
        }
        let mut out = vec![];
        r.items.iter().for_each(|i| go(i, &mut out));
        out
    }

    #[test]
    fn valid_product_is_clean_and_eligible() {
        let html = r#"<html><body><h1>Acme Shoe</h1><p>$19.99</p>
          <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Acme Shoe","image":"https://x.com/a.jpg",
          "offers":{"@type":"Offer","price":"19.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></body></html>"#;
        let r = validate(html, Some(&visible_text(html)));
        assert_eq!(r.errors, 0, "{:?}", issues(&r));
        assert_eq!(r.warnings, 0, "{:?}", issues(&r));
        assert_eq!(r.rich_results[0].feature, "Product snippet");
        assert_eq!(r.rich_results[0].status, "eligible");
        assert!(r.not_visible.is_empty(), "{:?}", r.not_visible);
    }

    #[test]
    fn catches_vocabulary_errors() {
        let html = r#"<script type="application/ld+json">{"@context":"https://schema.org","@type":"Prodcut","nmae":"X"}</script>
          <script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","price":"10","birthDate":"June 5"}</script>
          <script type="application/ld+json">{"@type":"Offer","availability":"in stock"}</script>
          <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article", }</script>"#;
        let r = validate(html, None);
        let all = issues(&r).join("\n");
        assert!(all.contains("Prodcut is not a schema.org type. Did you mean Product?"), "{all}");
        assert!(all.contains("nmae is not a schema.org property. Did you mean name?"), "{all}");
        assert!(all.contains("warning: The property price is not recognized by schema.org for an object of type Person"), "{all}");
        assert!(all.contains("error: birthDate expects a Date"), "{all}");
        assert!(all.contains("birthDate expects a Date"), "{all}");
        assert!(all.contains("Missing @context"), "{all}");
        assert!(!r.rich_results.iter().any(|x| x.feature == "Article"), "no-context items aren't read by Google");
        assert!(all.contains("availability expects one of the ItemAvailability values"), "{all}");
        assert_eq!(r.syntax_errors.len(), 1);
    }

    #[test]
    fn real_world_regressions() {
        // MediaWiki RDFa, a property used as a type, Action annotations, URL references,
        // typeless wrappers and product variants.
        let html = r#"<html><body><h1>Tree Runner</h1><p>Rated 4.6 from 9,951 reviews</p>
          <div typeof="mw:Transclusion"><span property="dc:title">x</span></div>
          <div itemscope itemtype="https://schema.org/abstract"></div>
          <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","url":"https://a.com",
            "potentialAction":{"@type":"SearchAction","target":"https://a.com/s?q={q}","query-input":"required name=q"}}</script>
          <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Tree Runner","mainEntity":"https://www.wikidata.org/entity/Q1"}</script>
          <script type="application/ld+json">{"@context":"https://schema.org","@type":"ProductGroup","name":"Tree Runner","hasVariant":[
            {"@type":"Product","name":"Tree Runner - Size 8","offers":{"@type":"Offer","price":"98","priceCurrency":"USD"}},
            {"@type":"Product","name":"Tree Runner - Size 9","offers":{"@type":"Offer","price":"98","priceCurrency":"USD"}}]}</script>
          <script type="application/ld+json">{"@context":"https://schema.org","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.6","reviewCount":"9951"}}</script>
          </body></html>"#;
        let r = validate(html, Some(&visible_text(html)));
        let all = issues(&r).join("\n");
        assert_eq!(r.formats, vec![("JSON-LD".to_string(), 4), ("Microdata".to_string(), 1)], "{all}");
        assert!(all.contains("error: abstract is a schema.org property, not a type."), "{all}");
        assert!(!all.contains("query-input") && !all.contains("mainEntity"), "{all}");
        assert!(all.contains("warning: This object has no @type"), "{all}");
        let features: Vec<&str> = r.rich_results.iter().map(|x| x.feature).collect();
        assert_eq!(features, vec!["Article", "Product variants", "Review snippet (aggregate)"]);
        assert!(r.not_visible.is_empty(), "{:?}", r.not_visible);
    }

    #[test]
    fn multi_type_and_number_matching() {
        let html = r#"<html><body><h1>Cookies</h1><p>Price $1,299.00. Item 1490.</p>
          <script type="application/ld+json">{"@context":"https://schema.org","@type":["Recipe","NewsArticle"],"name":"Cookies","headline":"Cookies","image":"https://a.com/c.jpg"}</script>
          <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Cookies","offers":[{"@type":"Offer","price":"1299","priceCurrency":"USD"},{"@type":"Offer","price":"49","priceCurrency":"USD"}]}</script>
          </body></html>"#;
        let r = validate(html, Some(&visible_text(html)));
        let f: Vec<&str> = r.rich_results.iter().map(|x| x.feature).collect();
        assert_eq!(f, vec!["Article", "Recipe", "Product snippet"]);
        let nv: Vec<&str> = r.not_visible.iter().map(|n| n.value.as_str()).collect();
        assert_eq!(nv, vec!["49"], "1299 matches $1,299.00; 49 must not match 1490");
        let html = r#"<p>Rated 3.7 out of 5</p><script type="application/ld+json">{"@context":"https://schema.org","@type":"Recipe","name":"Choco Cake","image":"x",
          "aggregateRating":{"@type":"AggregateRating","ratingValue":"3.690200210748156","ratingCount":"7"}}</script>"#;
        let r = validate(html, Some(&visible_text(html)));
        assert_eq!(r.not_visible.iter().map(|n| n.property.as_str()).collect::<Vec<_>>(), vec!["name", "ratingCount"]);
    }

    #[test]
    fn calendar_dates_are_checked() {
        assert!(is_date("2024-02-29") && is_datetime("2025-06-01T19:00") && is_datetime("2025-06-01T19:00:00+02:00"));
        assert!(!is_date("2025-13-45") && !is_date("2025-02-29") && !is_datetime("2025-06-01Tnoon"));
    }

    #[test]
    fn microdata_and_rdfa_are_extracted_and_nested() {
        let html = r#"<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Lamp</span>
            <div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="25"><meta itemprop="priceCurrency" content="EUR"></div></div>
            <div vocab="https://schema.org/" typeof="Person"><span property="name">Ada</span><span property="jobTitle">Engineer</span></div>"#;
        let r = validate(html, None);
        assert_eq!(r.formats, vec![("Microdata".to_string(), 1), ("RDFa".to_string(), 1)]);
        let product = &r.items[0];
        assert_eq!(product.types, vec!["https://schema.org/Product"]);
        let offers = product.properties.iter().find(|p| p.name == "offers").unwrap();
        assert!(matches!(&offers.values[0], SdValue::Item { item } if item.properties.iter().any(|p| p.name == "price")));
        assert_eq!(r.errors, 0, "{:?}", issues(&r));
    }

    #[test]
    fn rich_result_requirements_and_visibility() {
        let html = r#"<html><body><h1>Our event</h1>
          <script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Summer Gala 2026"}</script>
          <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Hidden Gadget","offers":{"@type":"Offer","price":"49","priceCurrency":"USD"}}</script>
          </body></html>"#;
        let r = validate(html, Some(&visible_text(html)));
        let ev = r.rich_results.iter().find(|x| x.feature == "Event").unwrap();
        assert_eq!(ev.status, "invalid");
        assert_eq!(ev.missing_required, vec!["startDate", "location"]);
        assert!(r.not_visible.iter().any(|v| v.property == "name" && v.value == "Summer Gala 2026"));
        assert!(r.not_visible.iter().any(|v| v.property == "price"));
    }

    #[test]
    fn graph_ids_resolve_for_range_checks() {
        let html = r##"<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
          {"@type":"Organization","@id":"#org","name":"Acme","url":"https://acme.com","logo":"https://acme.com/l.png"},
          {"@type":"Article","headline":"Hi","author":{"@id":"#org"},"publisher":{"@id":"#org"},"datePublished":"2025-01-02"}]}</script>"##;
        let r = validate(html, None);
        assert_eq!(r.errors + r.warnings, 0, "{:?}", issues(&r));
    }
}
