use crate::tags::meta::MetaProperties;
use crate::tags::heading::HeadingProperties;
use crate::tags::script::ScriptProperties;

pub fn parse(html: String) -> () {
  let metatags = MetaProperties::parse(html.clone());
  metatags.print_tags();

  let headingtags = HeadingProperties::parse(html.clone());
  headingtags.print_tags();

  let scriptags = ScriptProperties::parse(html.clone());
  scriptags.print_tags();
}