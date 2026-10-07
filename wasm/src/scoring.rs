//! Per-platform and per-category scores, and the prioritised fix plan.
//!
//! A platform's score is the severity-weighted share of its applicable checks
//! that pass (warnings earn half credit). A task's "gain" is how many points
//! that platform's score would rise if the task's check passed.

use crate::model::*;
use std::collections::BTreeMap;

fn credit(s: Status) -> f64 {
    match s {
        Status::Pass => 1.0,
        Status::Warn => 0.5,
        _ => 0.0,
    }
}

fn scored(c: &Check) -> bool {
    c.status != Status::Info
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

fn platform_totals(checks: &[Check]) -> BTreeMap<Platform, f64> {
    let mut t = BTreeMap::new();
    for c in checks.iter().filter(|c| scored(c)) {
        for p in &c.platforms {
            *t.entry(*p).or_insert(0.0) += c.severity.weight();
        }
    }
    t
}

pub fn platform_scores(checks: &[Check]) -> Vec<PlatformScore> {
    Platform::ALL
        .iter()
        .map(|&p| {
            let applicable: Vec<&Check> = checks.iter().filter(|c| scored(c) && c.platforms.contains(&p)).collect();
            let total: f64 = applicable.iter().map(|c| c.severity.weight()).sum();
            let earned: f64 = applicable.iter().map(|c| c.severity.weight() * credit(c.status)).sum();
            PlatformScore {
                platform: p,
                label: p.label(),
                score: if total > 0.0 { (earned / total * 100.0).round() as u8 } else { 100 },
                passed: applicable.iter().filter(|c| c.status == Status::Pass).count(),
                failed: applicable.iter().filter(|c| c.status == Status::Fail).count(),
                warnings: applicable.iter().filter(|c| c.status == Status::Warn).count(),
            }
        })
        .collect()
}

pub fn category_scores(checks: &[Check]) -> Vec<CategoryScore> {
    Category::ALL
        .iter()
        .map(|&cat| {
            let cs: Vec<&Check> = checks.iter().filter(|c| scored(c) && c.category == cat).collect();
            let total: f64 = cs.iter().map(|c| c.severity.weight()).sum();
            let earned: f64 = cs.iter().map(|c| c.severity.weight() * credit(c.status)).sum();
            CategoryScore {
                category: cat,
                label: cat.label(),
                score: if total > 0.0 { (earned / total * 100.0).round() as u8 } else { 100 },
                passed: cs.iter().filter(|c| c.status == Status::Pass).count(),
                total: cs.len(),
            }
        })
        .collect()
}

pub fn summary(checks: &[Check]) -> Summary {
    let total_w: f64 = checks.iter().filter(|c| scored(c)).map(|c| c.severity.weight()).sum();
    let earned: f64 = checks.iter().filter(|c| scored(c)).map(|c| c.severity.weight() * credit(c.status)).sum();
    Summary {
        overall: if total_w > 0.0 { (earned / total_w * 100.0).round() as u8 } else { 100 },
        critical: checks.iter().filter(|c| c.status == Status::Fail && c.severity == Severity::Critical).count(),
        failed: checks.iter().filter(|c| c.status == Status::Fail).count(),
        warnings: checks.iter().filter(|c| c.status == Status::Warn).count(),
        passed: checks.iter().filter(|c| c.status == Status::Pass).count(),
        total: checks.iter().filter(|c| scored(c)).count(),
    }
}

pub fn plan(checks: &[Check]) -> Vec<PlanPhase> {
    let totals = platform_totals(checks);
    let mut blockers = Vec::new();
    let mut quick = Vec::new();
    let mut foundations = Vec::new();
    let mut polish = Vec::new();

    for c in checks.iter().filter(|c| matches!(c.status, Status::Fail | Status::Warn)) {
        let missing = c.severity.weight() * (1.0 - credit(c.status));
        let gains: BTreeMap<Platform, f64> =
            c.platforms.iter().filter_map(|p| totals.get(p).map(|t| (*p, round1(missing / t * 100.0)))).collect();
        let total_gain = round1(gains.values().sum());
        let task = PlanTask {
            check_id: c.id,
            title: c.title.to_string(),
            category: c.category,
            severity: c.severity,
            effort: c.effort,
            platforms: c.platforms.clone(),
            recommendation: c.recommendation.clone(),
            gains,
            total_gain,
        };
        let hard_fail = c.status == Status::Fail && c.severity <= Severity::High;
        if c.severity == Severity::Critical || hard_fail {
            blockers.push(task);
        } else if c.effort == Effort::Low && c.severity <= Severity::Medium {
            quick.push(task);
        } else if c.severity <= Severity::Medium {
            foundations.push(task);
        } else {
            polish.push(task);
        }
    }

    // Highest gain per unit of effort first.
    let effort_cost = |e: Effort| match e {
        Effort::Low => 1.0,
        Effort::Medium => 2.0,
        Effort::High => 4.0,
    };
    for list in [&mut blockers, &mut quick, &mut foundations, &mut polish] {
        list.sort_by(|a, b| {
            (b.total_gain / effort_cost(b.effort))
                .partial_cmp(&(a.total_gain / effort_cost(a.effort)))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    vec![
        PlanPhase { id: "blockers", title: "Fix blockers", description: "Issues that stop search engines or AI assistants from finding, indexing or citing this page. Do these first.", tasks: blockers },
        PlanPhase { id: "quick-wins", title: "Quick wins", description: "Low-effort changes, usually one or two tags, with a meaningful score impact.", tasks: quick },
        PlanPhase { id: "foundations", title: "Strengthen foundations", description: "Content, structured data and performance work that compounds over time.", tasks: foundations },
        PlanPhase { id: "polish", title: "Polish", description: "Minor improvements once everything else is in place.", tasks: polish },
    ]
}
