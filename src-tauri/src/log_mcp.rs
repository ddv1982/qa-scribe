#[cfg(unix)]
const SERVER: &str = "qa_logs";
#[cfg(unix)]
const TOOL: &str = "query_application_logs";
const MODE: &str = "--mcp-logs";
pub(crate) const TOKEN_ENV: &str = "QA_SCRIBE_LOG_MCP_TOKEN";

#[cfg(unix)]
pub(crate) mod broker;
#[cfg(unix)]
mod provider;
#[cfg(unix)]
mod relay;

pub(crate) fn run_headless() -> bool {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new(MODE)) {
        return false;
    }
    #[cfg(unix)]
    if let (Some(socket), None) = (args.next(), args.next()) {
        if relay::run(socket.as_ref()).is_err() {
            std::process::exit(1);
        }
        return true;
    }
    std::process::exit(2);
}
