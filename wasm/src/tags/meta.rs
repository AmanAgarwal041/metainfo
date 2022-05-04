use regex::Regex;
use std::str::Split;
use crate::helpers::logger::log;

#[derive(Debug)]
#[derive(PartialEq)]
pub enum MetaType {
  IOS,
  FACEBOOK,
  THEME,
  TWITTER,
  NONE,
}

pub struct MetaTag {
  name: String,
  property: String,
  content: String,
  tag_type: MetaType,
}

impl MetaTag {
  pub fn new() -> MetaTag {
    MetaTag {
      name: String::new(),
      property: String::new(),
      content: String::new(),
      tag_type: MetaType::NONE,
    }
  }
  pub fn set_value(&mut self, key: &str, value: &str) {
    if key == "name" {
      self.name = value.to_string();
    } else if key == "property" {
      self.property = value.to_string();
    } else if key == "content" {
      self.content = value.to_string();
    }
  }

  pub fn set_type(&mut self, value: MetaType) {
    self.tag_type = value;
  }

  pub fn update_meta_if_none(&mut self) {
    if self.tag_type == MetaType::NONE {
      if self.name.starts_with("facebook-domain-verification") {
        self.set_type(MetaType::FACEBOOK);
      } else if self.name.starts_with("apple-") {
        self.set_type(MetaType::IOS);
      } else if self.name.starts_with("theme-color") {
        self.set_type(MetaType::THEME);
      }
    }
  }
}

pub struct MetaProperties {
  tags: Vec<MetaTag>,
}

impl MetaProperties {
  pub fn new() -> MetaProperties {
    MetaProperties { tags: Vec::new() }
  }

  pub fn parse(html: String) -> MetaProperties {
    let meta_tags_regex = Regex::new("<meta\\s(?:\"[^\"]*\"['\"]*|'[^']*'['\"]*|[^'\">])+>").unwrap();
    let mut metatags = MetaProperties::new();
    for cap in meta_tags_regex.captures_iter(&html) {
      metatags.add(&cap[0]);
    };

    metatags
  }

  pub fn add(&mut self, tag: &str) {
    let meta_tag: MetaTag = self.convert_tag(tag);
    self.tags.push(meta_tag);
  }

  pub fn convert_tag(&mut self, tag: &str) -> MetaTag {
    let meta_regex: regex::Regex = Regex::new(r#"\s+([^=]*)=\\"([^\\]*)\\""#).unwrap();
    let mut temp_meta = MetaTag::new();

    let empty_string = String::new();
    let mut temp_arr: Split<&str> = empty_string.split("");
    for cap in meta_regex.captures_iter(&tag) {
      if cap[1].contains("property") {
        if cap[2].starts_with("og:") {
          temp_arr = cap.get(2).unwrap().as_str().split(":");
          temp_meta.set_type(MetaType::FACEBOOK);
        } else if cap[2].starts_with("twitter:") {
          temp_arr = cap.get(2).unwrap().as_str().split(":");
          temp_meta.set_type(MetaType::TWITTER);
        } else {
          temp_meta.set_type(MetaType::NONE);
        }
      } else {
        temp_meta.set_value(&cap[1], &cap[2]);
      }
    }

    let last_element_temp_arr = temp_arr.last().unwrap();
    if temp_meta.name.len() == 0 && last_element_temp_arr.len() > 0 {
      temp_meta.set_value("name", last_element_temp_arr);
    }

    temp_meta.update_meta_if_none();

    temp_meta
  }
  pub fn print_tags(&self) -> () {
    for meta in &self.tags {
      log(format!(
        "{} - {:?} - {} - {}",
        meta.name, meta.tag_type, meta.content, meta.property
      ));
    }
  }
}
