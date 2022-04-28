
use wasm_bindgen::prelude::*;
// use std::future::Future;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen::JsCast;
use web_sys::{Request, RequestInit, RequestMode, Response};
use js_sys::JsString;
// use reqwest::Error;
// use reqwest::Response;
mod parse_html;
pub(crate) mod tags;

#[wasm_bindgen]
pub async fn run(data: String, mode: isize) -> Result<JsValue, JsValue> {
    match mode {
        1 => {
            let mut opts = RequestInit::new();
            opts.method("GET");
            opts.mode(RequestMode::Cors);
        
            let request = Request::new_with_str_and_init(&data, &opts)?;
        
        
            let window = web_sys::window().unwrap();
            let resp_value = JsFuture::from(window.fetch_with_request(&request)).await?;
        
            // `resp_value` is a `Response` object.
            assert!(resp_value.is_instance_of::<Response>());
            let resp: Response = resp_value.dyn_into().unwrap();
        
            // Convert this other `Promise` into a rust `Future`.
            let json = JsFuture::from(resp.text()?).await?;
        
            parse_html::parse(format!("{:?}", JsString::try_from(&json)));
        
            // println!("{:?}", JsString::try_from(&json));
            // Send the `Branch` struct back to JS as an `Object`.
            Ok(json)
        },
        2 => {
            parse_html::parse(format!("{:?}", data));
            Ok(JsValue::TRUE)
        },
        _ => {
            Ok(JsValue::undefined())
        }
    }
    
}

#[wasm_bindgen]
pub fn get_url(url: &str) -> String {
    return format!("
        This is the url :: {}
    ", url);
}