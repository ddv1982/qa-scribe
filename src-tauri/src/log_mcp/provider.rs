use std::{fs::File, io, os::unix::fs::OpenOptionsExt, path::Path};

use qa_scribe_core::{ai::GenerationCommand, domain::AiProvider};
use serde_json::json;

use super::{MODE, TOKEN_ENV, TOOL, relay::TOOL_TIMEOUT_SECS};

pub(super) fn configure(
    command: &mut GenerationCommand,
    provider: AiProvider,
    server: &str,
    socket: &Path,
    token: &str,
) -> io::Result<()> {
    let executable = std::env::current_exe()?;
    let executable = executable.to_str().ok_or(io::ErrorKind::InvalidInput)?;
    let dir = socket.parent().ok_or(io::ErrorKind::InvalidInput)?;
    match provider {
        AiProvider::ClaudeCode => {
            let file = dir.join("mcp.json");
            let writer = File::options()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&file)?;
            serde_json::to_writer(
                writer,
                &json!({
                    "mcpServers": {
                        server: {
                            "command": executable,
                            "args": [MODE, socket.to_str().ok_or(io::ErrorKind::InvalidInput)?],
                            "env": {TOKEN_ENV: token},
                        "timeout": TOOL_TIMEOUT_SECS * 1000
                        }
                    }
                }),
            )?;
            command.args.extend([
                "--mcp-config".into(),
                file.to_str().ok_or(io::ErrorKind::InvalidInput)?.into(),
                "--allowedTools".into(),
                format!("mcp__{server}__{TOOL}"),
            ]);
        }
        AiProvider::CodexCli => {
            // Set the entire uniquely named entry, leaving existing servers alone.
            let config = [
                format!("command={}", json!(executable)),
                format!(
                    "args={}",
                    json!([MODE, socket.to_str().ok_or(io::ErrorKind::InvalidInput)?])
                ),
                format!("env_vars={}", json!([TOKEN_ENV])),
                format!("enabled_tools={}", json!([TOOL])),
                format!("tool_timeout_sec={TOOL_TIMEOUT_SECS}"),
                format!("tools.{}.approval_mode=\"approve\"", TOOL),
            ]
            .into_iter()
            .flat_map(|field| ["-c".to_string(), format!("mcp_servers.{server}.{field}")]);
            command.args.splice(..0, config);
        }
        AiProvider::CopilotCli => return Err(io::ErrorKind::Unsupported.into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use qa_scribe_core::ai::GenerationOutputFormat;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn provider_configuration_never_puts_token_in_arguments() {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("socket");
        let secret = "per-job-token";
        for provider in [AiProvider::ClaudeCode, AiProvider::CodexCli] {
            let mut command = GenerationCommand {
                args: vec!["existing-arg".into()],
                output_format: GenerationOutputFormat::PlainText,
                program: provider.as_str().into(),
                stdin: String::new(),
            };
            let server = "qa_scribe_logs_one";
            configure(&mut command, provider, server, &socket, secret).unwrap();
            assert_eq!(
                command
                    .args
                    .iter()
                    .filter(|arg| arg.as_str() == "existing-arg")
                    .count(),
                1
            );
            assert!(command.args.iter().all(|arg| !arg.contains(secret)));
            match provider {
                AiProvider::ClaudeCode => {
                    let file = dir.path().join("mcp.json");
                    assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o600);
                    let value: serde_json::Value =
                        serde_json::from_reader(File::open(file).unwrap()).unwrap();
                    assert_eq!(value["mcpServers"][server]["env"][TOKEN_ENV], secret);
                    assert_eq!(value["mcpServers"][server]["args"][0], MODE);
                    assert!(command.args.contains(&format!("mcp__{server}__{TOOL}")));
                    assert!(!command.args.contains(&"--strict-mcp-config".into()));
                }
                AiProvider::CodexCli => {
                    assert!(
                        command
                            .args
                            .iter()
                            .any(|arg| arg.contains("tool_timeout_sec=150"))
                    );
                    assert!(command.args.iter().any(|arg| arg.contains(TOKEN_ENV)));
                }
                AiProvider::CopilotCli => unreachable!(),
            }
        }
    }
}
