fn main() {
    let status = qa_scribe_core::app_status();
    let json = serde_json::to_string_pretty(&status).expect("status should serialize");
    println!("{json}");
}
