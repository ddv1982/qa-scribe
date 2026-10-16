#[test]
fn chat_duplex_process_shared_replay_preserves_exact_frames_and_terminal_output() {
    for (provider, name) in [
        (AiProvider::ClaudeCode, "claude-queued.json"),
        (AiProvider::CodexCli, "codex-queued.json"),
        (AiProvider::CopilotCli, "copilot-queued.json"),
    ] {
        let transcript: Value = serde_json::from_str(
            &fs::read_to_string(
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../e2e/fixtures/chat-replay")
                    .join(name),
            )
            .unwrap(),
        )
        .unwrap();
        let expected_updates = transcript["steps"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|step| step["events"].as_array())
            .flatten()
            .filter(|event| {
                event.get("delta").is_some()
                    || event.get("snapshot").is_some()
                    || event.get("progress").is_some()
            })
            .cloned()
            .collect::<Vec<_>>();
        let fixture = Fixture::new(provider);
        let mut decisions = 0;
        let mut text = String::new();
        let mut updates = Vec::new();
        let output = fixture
            .run(
                &format!("replay:{name}"),
                "string",
                |update| {
                    match &update {
                        StreamUpdate::PartialDelta(delta) => text.push_str(delta),
                        StreamUpdate::PartialSnapshot(snapshot) => text = snapshot.clone(),
                        StreamUpdate::Progress(_) => {}
                    }
                    updates.push(match update {
                        StreamUpdate::PartialDelta(text) => json!({"delta":text}),
                        StreamUpdate::PartialSnapshot(text) => json!({"snapshot":text}),
                        StreamUpdate::Progress(text) => json!({"progress":text}),
                    });
                },
                |status| {
                    if status.pending_permission.is_some() {
                        let decision = if decisions == 0 {
                            ChatPermissionDecision::Approve
                        } else {
                            ChatPermissionDecision::Deny
                        };
                        decisions += 1;
                        fixture.decide(status, decision);
                    }
                },
            )
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(decisions, 2, "{name}");
        assert!(output.success(), "{name}: {}", output.failure_message());
        assert_eq!(output.response_text().unwrap(), "Connected.");
        assert_eq!(text, "Connected.");
        assert_eq!(updates, expected_updates, "{name}");
        let records = fixture.records();
        let releases = records
            .iter()
            .filter_map(|record| record["replay_release"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            &releases[releases.len() - 2..],
            &["approve-head", "deny-next"]
        );
        assert!(
            records
                .iter()
                .any(|record| record["replay_terminal"] == json!({"ok":"Connected."}))
        );
        assert!(
            fixture
                .jobs
                .status("job")
                .unwrap()
                .pending_permission
                .is_none()
        );
    }
}
