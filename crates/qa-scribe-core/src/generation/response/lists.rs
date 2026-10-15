use super::attribute_value;

pub(super) fn sanitize_ordered_list_tag(raw_tag: &str) -> String {
    let start = attribute_value(raw_tag, "start")
        .and_then(|value| value.trim().parse::<i64>().ok())
        .filter(|value| (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(value));
    match start {
        Some(start) => format!("<ol start=\"{start}\">"),
        None => "<ol>".to_string(),
    }
}
