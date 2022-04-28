use regex::Regex;
use std::str::Split;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
  // Use `js_namespace` here to bind `console.log(..)` instead of just
  // `log(..)`
  #[wasm_bindgen(js_namespace = console)]
  fn log(s: String);
}

#[derive(Debug)]
#[derive(PartialEq)]
pub enum HeadingType {
  H1,
  H2,
  H3,
  H4,
  H5,
  H6,
  NONE
}

pub struct HeadingTag {
  content: String,
  tag_type: HeadingType,
}

impl HeadingTag {
  pub fn new() -> HeadingTag {
    HeadingTag {
      content: String::new(),
      tag_type: HeadingType::NONE,
    }
  }

  pub fn set_content(&mut self, value: &str) {
    self.content = value.to_string();
  }

  pub fn set_tag_type(&mut self, value: &str) {
    match value {
      "1" => {
        self.tag_type = HeadingType::H1;
      },
      "2" => {
        self.tag_type = HeadingType::H2;
      },
      "3" => {
        self.tag_type = HeadingType::H3;
      },
      "4" => {
        self.tag_type = HeadingType::H4;
      },
      "5" => {
        self.tag_type = HeadingType::H5;
      },
      "6" => {
        self.tag_type = HeadingType::H6;
      }
      _ => {
        self.tag_type = HeadingType::NONE;
      }
    }
  }
}

pub struct HeadingProperties {
  tags: Vec<HeadingTag>,
}

impl HeadingProperties {
  pub fn new() -> HeadingProperties {
    HeadingProperties { tags: Vec::new() }
  }

  pub fn parse(html: String) -> HeadingProperties {
    let heading_regex = Regex::new("<h([1-6])[^>]*>(.*?)</h[1-6]>").unwrap();
    let mut heading_tags = HeadingProperties::new();
    for cap in heading_regex.captures_iter(&html) {
      heading_tags.add(&cap[1], &cap[2]);
    };

    heading_tags
  }

  pub fn add(&mut self, heading_type: &str, heading_content: &str) {
    let mut heading_tag = HeadingTag::new();
    heading_tag.set_tag_type(heading_type);
    heading_tag.set_content(heading_content);
    self.tags.push(heading_tag);
  }

  pub fn print_tags(&self) -> () {
    for heading in &self.tags {
      log(format!(
        "{:?} - {}",
        heading.tag_type, heading.content
      ));
    }
  }
}
