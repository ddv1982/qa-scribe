pub fn parse_session_report_response(response: &str) -> String {
    let trimmed = response.trim();
    if let Some(stripped) = trimmed.strip_prefix("```markdown") {
        return stripped.trim_end_matches("```").trim().to_string();
    }
    if let Some(stripped) = trimmed.strip_prefix("```") {
        return stripped.trim_end_matches("```").trim().to_string();
    }
    trimmed.to_string()
}
