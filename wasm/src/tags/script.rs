use regex::Regex;
use crate::helpers::logger::log;

#[derive(Debug)]
#[derive(PartialEq)]
pub enum ScriptType {
  LDJSON,
  NONE
}

pub struct ScriptTag {
  content: String,
  tag_type: ScriptType,
}

impl ScriptTag {
  pub fn new() -> ScriptTag {
    ScriptTag {
      content: String::new(),
      tag_type: ScriptType::NONE,
    }
  }
  pub fn set_content(&mut self, value: &str) {
    self.content = value.to_string();
  }

  pub fn set_type(&mut self, type_string: &str) {
    match type_string {
      "application/ld+json" => {
        self.tag_type = ScriptType::LDJSON;
      },
      _ => {
        self.tag_type = ScriptType::NONE;
      }
    }
  }
}

pub struct ScriptProperties {
  tags: Vec<ScriptTag>,
}

impl ScriptProperties {
  pub fn new() -> ScriptProperties {
    ScriptProperties { tags: Vec::new() }
  }

  pub fn parse(html: String) -> ScriptProperties {
    let script_tags_regex: regex::Regex = Regex::new(r#"<script[^<]*type=\\"([^\\"]*?)\\"[^<]*?>([^<]*?)</script>"#).unwrap();
    let mut scripttags = ScriptProperties::new();
    for cap in script_tags_regex.captures_iter(&html) {
      scripttags.add(&cap[1], &cap[2]);
    };

    scripttags
  }

  pub fn add(&mut self, type_string: &str, content: &str) {
    let mut script_tag = ScriptTag::new();
    script_tag.set_type(type_string);
    script_tag.set_content(content);
    self.tags.push(script_tag);
  }

  pub fn print_tags(&self) -> () {
    for script in &self.tags {
      log(format!(
        "{} - {:?}",
        script.content, script.tag_type
      ));
    }
  }
}
