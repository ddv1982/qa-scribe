const MANAGED_ATTACHMENT_PROTOCOL: &str = "qa-scribe-attachment://";

pub fn project_html_to_prompt_text(value: &str) -> String {
    let mut projector = HtmlPromptProjector::new(value);
    projector.project()
}

struct HtmlPromptProjector<'a> {
    source: &'a str,
    output: String,
    link_stack: Vec<String>,
}

impl<'a> HtmlPromptProjector<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            output: String::new(),
            link_stack: Vec::new(),
        }
    }

    fn project(&mut self) -> String {
        let mut index = 0usize;
        while let Some(relative_tag_start) = self.source[index..].find('<') {
            let tag_start = index + relative_tag_start;
            self.push_text(&self.source[index..tag_start]);

            let Some(relative_tag_end) = self.source[tag_start..].find('>') else {
                self.push_text(&self.source[tag_start..]);
                index = self.source.len();
                break;
            };

            let tag_end = tag_start + relative_tag_end;
            let raw_tag = &self.source[tag_start + 1..tag_end];
            let tag = Tag::parse(raw_tag);
            index = tag_end + 1;

            if tag.is_comment_or_declaration {
                continue;
            }

            if !tag.closing && (tag.name == "script" || tag.name == "style") {
                if let Some(close_start) =
                    find_case_insensitive(&self.source[index..], &format!("</{}>", tag.name))
                {
                    index += close_start + tag.name.len() + 3;
                }
                continue;
            }

            self.handle_tag(raw_tag, &tag);
        }

        if index < self.source.len() {
            self.push_text(&self.source[index..]);
        }

        normalize_prompt_text(&self.output)
    }

    fn handle_tag(&mut self, raw_tag: &str, tag: &Tag) {
        match (tag.closing, tag.name.as_str()) {
            (false, "br") => self.push_newline(),
            (false, "p" | "div" | "section" | "article" | "blockquote") => self.push_block_start(),
            (true, "p" | "div" | "section" | "article" | "blockquote") => self.push_newline(),
            (false, "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => self.push_newline(),
            (true, "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => self.push_newline(),
            (false, "ul" | "ol") => self.push_newline(),
            (true, "ul" | "ol") => self.push_newline(),
            (false, "li") => {
                self.push_newline();
                self.push_literal("- ");
            }
            (true, "li") => self.push_newline(),
            (false, "input") if has_attribute(raw_tag, "type", "checkbox") => {
                if attribute_value(raw_tag, "checked").is_some() {
                    self.push_literal("[x] ");
                } else {
                    self.push_literal("[ ] ");
                }
            }
            (false, "img") => self.push_image(raw_tag),
            (false, "a") => {
                if let Some(href) = attribute_value(raw_tag, "href")
                    .map(|href| href.trim().to_string())
                    .filter(|href| {
                        !href.is_empty() && !href.to_ascii_lowercase().starts_with("data:")
                    })
                {
                    self.link_stack.push(href);
                } else {
                    self.link_stack.push(String::new());
                }
            }
            (true, "a") => {
                if let Some(href) = self.link_stack.pop().filter(|href| !href.is_empty()) {
                    self.push_literal(" (");
                    self.push_text(&href);
                    self.push_literal(")");
                }
            }
            _ => {}
        }
    }

    fn push_image(&mut self, raw_tag: &str) {
        let alt = attribute_value(raw_tag, "alt")
            .map(|value| project_html_to_prompt_text(&value))
            .filter(|value| !value.is_empty());
        let attachment = attribute_value(raw_tag, "data-attachment-id")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let source = attribute_value(raw_tag, "src")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let label = alt
            .or_else(|| image_label_from_source(source.as_deref()))
            .or_else(|| attachment.map(|id| format!("attachment {id}")));

        self.push_newline();
        match label {
            Some(label) => {
                self.push_literal("[Image: ");
                self.push_text(&label);
                self.push_literal("]");
            }
            None => self.push_literal("[Image]"),
        }
        self.push_newline();
    }

    fn push_text(&mut self, text: &str) {
        let decoded = decode_html_entities(text);
        let redacted = redact_data_urls(&decoded);
        for character in redacted.chars() {
            if character.is_whitespace() {
                if !self.output.ends_with(' ') && !self.output.ends_with('\n') {
                    self.output.push(' ');
                }
            } else {
                self.output.push(character);
            }
        }
    }

    fn push_literal(&mut self, text: &str) {
        self.output.push_str(text);
    }

    fn push_newline(&mut self) {
        while self.output.ends_with(' ') {
            self.output.pop();
        }
        if !self.output.ends_with('\n') {
            self.output.push('\n');
        }
    }

    fn push_block_start(&mut self) {
        if self.output.ends_with("- ")
            || self.output.ends_with("- [x] ")
            || self.output.ends_with("- [ ] ")
        {
            return;
        }

        self.push_newline();
    }
}

struct Tag {
    name: String,
    closing: bool,
    is_comment_or_declaration: bool,
}

impl Tag {
    fn parse(raw_tag: &str) -> Self {
        let trimmed = raw_tag.trim();
        let is_comment_or_declaration = trimmed.starts_with('!') || trimmed.starts_with('?');
        let closing = trimmed.starts_with('/');
        let tag_body = trimmed.trim_start_matches('/').trim_start();
        let name = tag_body
            .chars()
            .take_while(|character| {
                character.is_ascii_alphanumeric() || *character == '-' || *character == ':'
            })
            .collect::<String>()
            .to_ascii_lowercase();

        Self {
            name,
            closing,
            is_comment_or_declaration,
        }
    }
}

fn attribute_value(raw_tag: &str, attribute: &str) -> Option<String> {
    let mut index = raw_tag.find(char::is_whitespace).unwrap_or(raw_tag.len());
    while index < raw_tag.len() {
        index = skip_whitespace(raw_tag, index);
        if index >= raw_tag.len() {
            return None;
        }
        if raw_tag[index..].starts_with('/') {
            index += 1;
            continue;
        }

        let name_start = index;
        while index < raw_tag.len() {
            let character = raw_tag[index..].chars().next()?;
            if character.is_whitespace() || character == '=' || character == '/' {
                break;
            }
            index += character.len_utf8();
        }
        if name_start == index {
            index += raw_tag[index..].chars().next()?.len_utf8();
            continue;
        }
        let name = raw_tag[name_start..index].to_ascii_lowercase();
        index = skip_whitespace(raw_tag, index);

        let value = if raw_tag[index..].starts_with('=') {
            index += 1;
            index = skip_whitespace(raw_tag, index);
            if index >= raw_tag.len() {
                String::new()
            } else {
                let quote = raw_tag[index..].chars().next()?;
                if quote == '"' || quote == '\'' {
                    index += quote.len_utf8();
                    let value_start = index;
                    let mut value_end = raw_tag.len();
                    while index < raw_tag.len() {
                        let character = raw_tag[index..].chars().next()?;
                        if character == quote {
                            value_end = index;
                            index += quote.len_utf8();
                            break;
                        }
                        index += character.len_utf8();
                    }
                    raw_tag[value_start..value_end].to_string()
                } else {
                    let value_start = index;
                    while index < raw_tag.len() {
                        let character = raw_tag[index..].chars().next()?;
                        if character.is_whitespace() || character == '/' {
                            break;
                        }
                        index += character.len_utf8();
                    }
                    raw_tag[value_start..index].to_string()
                }
            }
        } else {
            String::new()
        };

        if name == attribute.to_ascii_lowercase() {
            return Some(decode_html_entities(&value));
        }
    }
    None
}

fn has_attribute(raw_tag: &str, attribute: &str, value: &str) -> bool {
    attribute_value(raw_tag, attribute)
        .map(|candidate| candidate.eq_ignore_ascii_case(value))
        .unwrap_or(false)
}

fn skip_whitespace(value: &str, mut index: usize) -> usize {
    while index < value.len() {
        let Some(character) = value[index..].chars().next() else {
            break;
        };
        if !character.is_whitespace() {
            break;
        }
        index += character.len_utf8();
    }
    index
}

fn decode_html_entities(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut index = 0usize;
    while let Some(relative_start) = value[index..].find('&') {
        let start = index + relative_start;
        output.push_str(&value[index..start]);
        let Some(relative_end) = value[start..].find(';') else {
            output.push_str(&value[start..]);
            return output;
        };
        let end = start + relative_end;
        if end - start > 32 {
            output.push('&');
            index = start + 1;
            continue;
        }
        let entity = &value[start + 1..end];
        match decode_entity(entity) {
            Some(decoded) => output.push_str(&decoded),
            None => output.push_str(&value[start..=end]),
        }
        index = end + 1;
    }
    output.push_str(&value[index..]);
    output
}

fn decode_entity(entity: &str) -> Option<String> {
    match entity {
        "amp" => Some("&".to_string()),
        "lt" => Some("<".to_string()),
        "gt" => Some(">".to_string()),
        "quot" => Some("\"".to_string()),
        "apos" | "#39" => Some("'".to_string()),
        "nbsp" => Some(" ".to_string()),
        "ndash" | "mdash" => Some("-".to_string()),
        "hellip" => Some("...".to_string()),
        "lsquo" | "rsquo" => Some("'".to_string()),
        "ldquo" | "rdquo" => Some("\"".to_string()),
        _ => decode_numeric_entity(entity),
    }
}

fn decode_numeric_entity(entity: &str) -> Option<String> {
    let number = if let Some(hex) = entity
        .strip_prefix("#x")
        .or_else(|| entity.strip_prefix("#X"))
    {
        u32::from_str_radix(hex, 16).ok()?
    } else if let Some(decimal) = entity.strip_prefix('#') {
        decimal.parse::<u32>().ok()?
    } else {
        return None;
    };
    char::from_u32(number).map(|character| character.to_string())
}

fn image_label_from_source(source: Option<&str>) -> Option<String> {
    let source = source?;
    if source.to_ascii_lowercase().starts_with("data:") {
        return None;
    }
    if let Some(attachment_id) = source.strip_prefix(MANAGED_ATTACHMENT_PROTOCOL) {
        return Some(format!("attachment {attachment_id}"));
    }
    let without_query = source.split(['?', '#']).next().unwrap_or(source);
    without_query
        .rsplit('/')
        .next()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
}

fn redact_data_urls(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut index = 0usize;
    while let Some(relative_start) = find_case_insensitive(&value[index..], "data:") {
        let start = index + relative_start;
        output.push_str(&value[index..start]);
        let mut end = start;
        while end < value.len() {
            let Some(character) = value[end..].chars().next() else {
                break;
            };
            if character.is_whitespace() || matches!(character, '"' | '\'' | ')' | ']' | '<' | '>')
            {
                break;
            }
            end += character.len_utf8();
        }
        output.push_str("[data URL omitted]");
        index = end;
    }
    output.push_str(&value[index..]);
    output
}

fn find_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
}

fn normalize_prompt_text(value: &str) -> String {
    let mut lines = Vec::new();
    let mut previous_blank = true;
    for line in value.lines() {
        let cleaned = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if cleaned.is_empty() {
            if !previous_blank {
                lines.push(String::new());
            }
            previous_blank = true;
            continue;
        }
        lines.push(cleaned);
        previous_blank = false;
    }
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    lines.join("\n").trim().to_string()
}
