use wasm_bindgen::prelude::*;

use crate::tags::meta::MetaProperties;
use crate::tags::heading::HeadingProperties;

#[wasm_bindgen]
extern "C" {
    // Use `js_namespace` here to bind `console.log(..)` instead of just
    // `log(..)`
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: String);
}

pub fn parse(html: String) -> () {
  let metatags = MetaProperties::parse(html.clone());
  metatags.print_tags();

  let headingtags = HeadingProperties::parse(html.clone());
  headingtags.print_tags();
}