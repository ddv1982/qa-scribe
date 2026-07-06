use super::*;

#[test]
fn attribute_value_reads_double_and_single_quoted_values() {
    let tag = r#"img src="foo.png" alt='bar baz'"#;
    assert_eq!(attribute_value(tag, "src"), Some("foo.png".to_string()));
    assert_eq!(attribute_value(tag, "alt"), Some("bar baz".to_string()));
}

#[test]
fn attribute_value_reads_unquoted_values() {
    let tag = "input type=checkbox checked";
    assert_eq!(attribute_value(tag, "type"), Some("checkbox".to_string()));
    assert_eq!(attribute_value(tag, "checked"), Some(String::new()));
}

#[test]
fn attribute_value_is_case_insensitive_on_name() {
    let tag = r#"IMG SRC="foo.png""#;
    assert_eq!(attribute_value(tag, "src"), Some("foo.png".to_string()));
}

#[test]
fn attribute_value_handles_missing_attribute() {
    let tag = r#"img src="foo.png""#;
    assert_eq!(attribute_value(tag, "alt"), None);
}

#[test]
fn attribute_value_tolerates_irregular_whitespace() {
    let tag = "img   src = \"foo.png\"   alt=\"bar\"";
    assert_eq!(attribute_value(tag, "src"), Some("foo.png".to_string()));
    assert_eq!(attribute_value(tag, "alt"), Some("bar".to_string()));
}

#[test]
fn attribute_value_decodes_entities_in_the_value() {
    let tag = r#"a href="/x?a=1&amp;b=2" title="Say &quot;hi&quot;""#;
    assert_eq!(attribute_value(tag, "href"), Some("/x?a=1&b=2".to_string()));
    assert_eq!(
        attribute_value(tag, "title"),
        Some("Say \"hi\"".to_string())
    );
}

#[test]
fn skip_whitespace_advances_past_spaces_and_newlines() {
    let value = "  \n\t x";
    let index = skip_whitespace(value, 0);
    assert_eq!(&value[index..], "x");
}

#[test]
fn skip_whitespace_is_a_no_op_when_not_on_whitespace() {
    assert_eq!(skip_whitespace("abc", 0), 0);
}

#[test]
fn decode_html_entities_covers_the_union_of_known_entities() {
    assert_eq!(decode_html_entities("&amp;&lt;&gt;&quot;"), "&<>\"");
    assert_eq!(decode_html_entities("&apos;&#39;"), "''");
    assert_eq!(decode_html_entities("&nbsp;&ndash;&mdash;"), " --");
    assert_eq!(decode_html_entities("&hellip;"), "...");
    assert_eq!(
        decode_html_entities("&lsquo;&rsquo;&ldquo;&rdquo;"),
        "''\"\""
    );
}

#[test]
fn decode_html_entities_handles_numeric_references() {
    assert_eq!(decode_html_entities("&#39;"), "'");
    assert_eq!(decode_html_entities("&#x27;"), "'");
    assert_eq!(decode_html_entities("&#X27;"), "'");
}

#[test]
fn decode_html_entities_leaves_unknown_entities_untouched() {
    assert_eq!(decode_html_entities("&unknown;"), "&unknown;");
}

#[test]
fn decode_html_entities_does_not_double_decode() {
    assert_eq!(decode_html_entities("&amp;amp;"), "&amp;");
}

#[test]
fn decode_html_entities_ignores_bare_ampersands() {
    assert_eq!(decode_html_entities("Ben & Jerry's"), "Ben & Jerry's");
}

#[test]
fn decode_html_entities_ignores_overlong_entity_candidates() {
    let value = format!("&{};", "x".repeat(40));
    assert_eq!(decode_html_entities(&value), value);
}

#[test]
fn decode_basic_html_entities_decodes_only_the_six_structural_entities() {
    assert_eq!(decode_basic_html_entities("&amp;&lt;&gt;&quot;"), "&<>\"");
    assert_eq!(decode_basic_html_entities("&apos;&#39;"), "''");
}

#[test]
fn decode_basic_html_entities_leaves_typographic_entities_literal() {
    // This is the crux of the repair-path/projection-path split: the
    // repair path (response.rs) must not widen into decoding
    // typographic entities or numeric character references, unlike the
    // projection decoder above.
    assert_eq!(
        decode_basic_html_entities("&nbsp;&mdash;&hellip;&#8217;&lsquo;&rsquo;"),
        "&nbsp;&mdash;&hellip;&#8217;&lsquo;&rsquo;"
    );
}

#[test]
fn decode_basic_html_entities_does_not_double_decode() {
    assert_eq!(decode_basic_html_entities("&amp;amp;"), "&amp;");
}

#[test]
fn decode_basic_html_entities_matches_pre_refactor_replace_chain_on_malformed_input() {
    // Regression test for a real divergence found while restoring this
    // decoder: unlike decode_html_entities (a scan-to-next-`;` loop),
    // the pre-refactor decoder was a sequential chain of exact
    // substring replacements. On input with a stray `&` between an
    // entity-like prefix and a `;`, the two algorithms disagree: the
    // scanning loop swallows the whole run as one (unknown) entity
    // candidate, while the replace-chain only touches the exact
    // trailing `&amp;` match. This decoder must keep the replace-chain
    // behavior to stay byte-identical to the pre-refactor version.
    assert_eq!(
        decode_basic_html_entities("text&lt;&amp&&amp;"),
        "text<&amp&&"
    );
}

#[test]
fn escape_html_attribute_escapes_reserved_characters() {
    assert_eq!(
        escape_html_attribute("<a> & \"b\""),
        "&lt;a&gt; &amp; &quot;b&quot;"
    );
}

#[test]
fn find_case_insensitive_matches_regardless_of_case() {
    assert_eq!(find_case_insensitive("Hello WORLD", "world"), Some(6));
    assert_eq!(find_case_insensitive("</SCRIPT>", "</script>"), Some(0));
}

#[test]
fn find_case_insensitive_returns_none_when_absent() {
    assert_eq!(find_case_insensitive("Hello", "xyz"), None);
}

#[test]
fn find_case_insensitive_handles_empty_needle_and_haystack() {
    assert_eq!(find_case_insensitive("abc", ""), Some(0));
    assert_eq!(find_case_insensitive("", "a"), None);
    assert_eq!(find_case_insensitive("", ""), Some(0));
}

#[test]
fn find_case_insensitive_only_matches_char_boundaries() {
    // "é" is a 2-byte UTF-8 character; make sure we don't panic or match
    // inside it while scanning byte-by-byte.
    let haystack = "café DATA:foo";
    assert_eq!(find_case_insensitive(haystack, "data:"), Some(6));
}

#[test]
fn find_case_insensitive_does_not_panic_when_multibyte_char_overlaps_match_window() {
    // Regression test: the match START boundary was guarded
    // (`is_char_boundary(start)`), but the END of the fixed-width
    // window (`start + needle_len`) was not. "data\u{2019}x" has the
    // multi-byte '\u{2019}' (right single quotation mark, 3 bytes in UTF-8) beginning right where
    // a 5-byte "data:" window would end, so the window
    // `haystack[start..start + needle_len]` slices into the middle of
    // that character and previously panicked with "byte index N is not a char
    // boundary". There is no valid case-insensitive match for "data:"
    // in this haystack, so the correct result is `None`, not a panic.
    let haystack = "data\u{2019}x";
    assert_eq!(find_case_insensitive(haystack, "data:"), None);
}
