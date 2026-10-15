use super::attribute_value;

pub(super) fn sanitize_ordered_list_tag(raw_tag: &str) -> String {
    let start = attribute_value(raw_tag, "start")
        .filter(|value| !value.starts_with('+'))
        .and_then(|value| value.parse::<i32>().ok());
    match start {
        Some(start) => format!("<ol start=\"{start}\">"),
        None => "<ol>".to_string(),
    }
}
