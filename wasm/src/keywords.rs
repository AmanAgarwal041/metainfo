//! On-page keyword extraction: the words and 2-3 word phrases a page is
//! actually about, weighted by where they appear (title, H1, headings,
//! description, URL) as well as how often. Feeds the keyword gap.

use serde::Serialize;
use std::collections::HashMap;

const MAX_TERMS: usize = 60;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Term {
    pub term: String,
    pub words: u8,
    pub count: usize,
    /// Occurrences per 100 words of body text.
    pub density: f64,
    pub score: f64,
    pub in_title: bool,
    pub in_h1: bool,
    pub in_headings: bool,
    pub in_description: bool,
    pub in_url: bool,
}

pub struct Zones<'a> {
    pub body: &'a str,
    pub title: Option<&'a str>,
    pub description: Option<&'a str>,
    pub h1: &'a [String],
    pub headings: &'a [String],
    pub url_path: &'a str,
}

const STOPWORDS: &[&str] = &[
    "a",
    "about",
    "above",
    "after",
    "again",
    "against",
    "all",
    "also",
    "am",
    "an",
    "and",
    "any",
    "are",
    "as",
    "at",
    "be",
    "because",
    "been",
    "before",
    "being",
    "below",
    "between",
    "both",
    "but",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "doing",
    "down",
    "during",
    "each",
    "even",
    "every",
    "few",
    "for",
    "from",
    "further",
    "get",
    "gets",
    "got",
    "had",
    "has",
    "have",
    "having",
    "he",
    "her",
    "here",
    "hers",
    "herself",
    "him",
    "himself",
    "his",
    "how",
    "however",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "itself",
    "just",
    "let",
    "like",
    "many",
    "may",
    "me",
    "might",
    "more",
    "most",
    "much",
    "must",
    "my",
    "myself",
    "no",
    "nor",
    "not",
    "now",
    "of",
    "off",
    "on",
    "once",
    "one",
    "only",
    "or",
    "other",
    "our",
    "ours",
    "ourselves",
    "out",
    "over",
    "own",
    "per",
    "same",
    "see",
    "she",
    "should",
    "since",
    "so",
    "some",
    "still",
    "such",
    "than",
    "that",
    "the",
    "their",
    "theirs",
    "them",
    "themselves",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "to",
    "too",
    "under",
    "until",
    "up",
    "upon",
    "us",
    "very",
    "via",
    "was",
    "we",
    "well",
    "were",
    "what",
    "when",
    "where",
    "which",
    "while",
    "who",
    "whom",
    "why",
    "will",
    "with",
    "within",
    "without",
    "would",
    "yet",
    "you",
    "your",
    "yours",
    "yourself",
    "yourselves",
    "s",
    "t",
    "don",
    "won",
    "ll",
    "re",
    "ve",
    "d",
    "m",
    "isn",
    "aren",
    "wasn",
    "doesn",
    "didn",
    "can't",
    "cannot",
    "etc",
    "e.g",
    "i.e",
    "click",
    "menu",
    "skip",
    "toggle",
    "cookie",
    "cookies",
    "rights",
    "reserved",
    "copyright",
    "©",
];

fn is_stop(w: &str) -> bool {
    STOPWORDS.contains(&w)
}

/// Lower-cased word tokens, split into runs at punctuation so phrases never
/// span a sentence or list boundary.
fn segments(text: &str) -> Vec<Vec<String>> {
    let mut out = Vec::new();
    for seg in text.split(|c: char| ".,!?;:()[]{}|/\\\"“”«»--·•→>\n\t".contains(c)) {
        let words: Vec<String> = seg
            .split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '-' || c == '+'))
            .map(|w| w.trim_matches(|c: char| c == '\'' || c == '-').to_lowercase())
            .filter(|w| !w.is_empty())
            .collect();
        if !words.is_empty() {
            out.push(words);
        }
    }
    out
}

fn usable_word(w: &str) -> bool {
    w.chars().count() >= 2 && !is_stop(w) && !w.chars().all(|c| c.is_ascii_digit())
}

fn ngrams(text: &str) -> HashMap<String, (usize, u8)> {
    let mut counts: HashMap<String, (usize, u8)> = HashMap::new();
    for seg in segments(text) {
        for n in 1..=3usize {
            if seg.len() < n {
                continue;
            }
            for win in seg.windows(n) {
                let (first, last) = (&win[0], &win[n - 1]);
                if !usable_word(first) || !usable_word(last) {
                    continue;
                }
                if n == 1 && first.chars().count() < 3 {
                    continue;
                }
                let key = win.join(" ");
                counts.entry(key).or_insert((0, n as u8)).0 += 1;
            }
        }
    }
    counts
}

fn contains_phrase(hay: &str, phrase: &str) -> bool {
    segments(hay).iter().any(|seg| {
        let words: Vec<&str> = phrase.split(' ').collect();
        seg.windows(words.len()).any(|w| w.iter().zip(&words).all(|(a, b)| a == b))
    })
}

/// Occurrences of each term in `body`, matched the same way terms are extracted.
pub fn count_terms(body: &str, terms: &[String]) -> Vec<usize> {
    let counts = ngrams(body);
    terms.iter().map(|t| counts.get(&t.trim().to_lowercase()).map(|c| c.0).unwrap_or(0)).collect()
}

pub fn extract(z: &Zones) -> Vec<Term> {
    let body_words = z.body.split_whitespace().count().max(1);
    let counts = ngrams(z.body);
    // Zone text also contributes candidates, so a term only in the title still shows up.
    let mut zone_text = String::new();
    for s in
        [z.title.unwrap_or(""), z.description.unwrap_or("")].into_iter().chain(z.headings.iter().map(String::as_str))
    {
        zone_text.push_str(s);
        zone_text.push('\n');
    }
    let zone_counts = ngrams(&zone_text);
    let url_text = z.url_path.replace(['-', '_', '/'], " ");
    let headings_joined = z.headings.join("\n");
    let h1_joined = z.h1.join("\n");

    let mut terms: Vec<Term> = counts
        .keys()
        .chain(zone_counts.keys())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .filter_map(|key| {
            let (count, words) = counts.get(key).copied().unwrap_or_else(|| (0, zone_counts[key].1));
            let in_title = z.title.map(|t| contains_phrase(t, key)).unwrap_or(false);
            let in_h1 = contains_phrase(&h1_joined, key);
            let in_headings = contains_phrase(&headings_joined, key);
            let in_description = z.description.map(|d| contains_phrase(d, key)).unwrap_or(false);
            let in_url = contains_phrase(&url_text, key);
            let zones = in_title as u8 + in_h1 as u8 + in_headings as u8 + in_description as u8;
            // Phrases need repetition or a prominent placement to count as a topic.
            if count < 2 && zones == 0 {
                return None;
            }
            // On pages with many H1s (Stripe has dozens), an H1 alone isn't a strong signal.
            let strong_h1 = in_h1 && z.h1.len() <= 2;
            if words > 1 && count < 2 && !(in_title || strong_h1) {
                return None;
            }
            let zone_boost = 6.0 * in_title as u8 as f64
                + 4.0 * in_h1 as u8 as f64
                + 2.0 * in_headings as u8 as f64
                + 3.0 * in_description as u8 as f64
                + 2.0 * in_url as u8 as f64;
            let length_boost = match words {
                1 => 1.0,
                2 => 1.6,
                _ => 2.0,
            };
            let score = ((count as f64).sqrt() * 3.0 + zone_boost) * length_boost;
            Some(Term {
                term: key.clone(),
                words,
                count,
                density: (count as f64 * words as f64 / body_words as f64 * 1000.0).round() / 10.0,
                score: (score * 10.0).round() / 10.0,
                in_title,
                in_h1,
                in_headings,
                in_description,
                in_url,
            })
        })
        .collect();

    terms.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal).then(a.term.cmp(&b.term)));

    // Drop a shorter term when a longer phrase containing it covers nearly all its uses.
    let mut kept: Vec<Term> = Vec::new();
    for t in terms {
        let subsumed = kept
            .iter()
            .any(|k| k.words > t.words && contains_phrase(&k.term, &t.term) && k.count as f64 >= t.count as f64 * 0.8);
        if !subsumed {
            kept.push(t);
        }
        if kept.len() >= MAX_TERMS {
            break;
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_weighted_phrases() {
        let body = "Rust web scraping is fast. Rust web scraping with async. Learn rust web scraping today. \
                    The scraping library handles HTML parsing. HTML parsing in Rust is easy.";
        let z = Zones {
            body,
            title: Some("Rust Web Scraping Guide"),
            description: Some("A guide to rust web scraping."),
            h1: &["Rust web scraping".into()],
            headings: &["Rust web scraping".into(), "HTML parsing".into()],
            url_path: "/guides/rust-web-scraping",
        };
        let t = extract(&z);
        assert_eq!(t[0].term, "rust web scraping");
        assert!(t[0].in_title && t[0].in_h1 && t[0].in_url && t[0].in_description);
        assert!(t.iter().any(|x| x.term == "html parsing" && x.in_headings));
        assert!(!t.iter().any(|x| x.term == "the" || x.term == "is"));
        // "web scraping" is always part of "rust web scraping", so it's folded in.
        assert!(!t.iter().any(|x| x.term == "web scraping"));
    }

    #[test]
    fn counts_terms() {
        let c =
            count_terms("HTML parsing. Fast html parsing!", &["html parsing".into(), "Parsing".into(), "xml".into()]);
        assert_eq!(c, vec![2, 2, 0]);
    }
}
