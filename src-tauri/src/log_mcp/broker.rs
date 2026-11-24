use std::{
    fs::Permissions,
    io::{self, BufRead, BufReader},
    os::{
        fd::AsRawFd,
        unix::{
            fs::PermissionsExt,
            net::{UnixListener, UnixStream},
        },
    },
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::RecvTimeoutError,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use qa_scribe_core::{
    ai::GenerationCommand,
    domain::{
        AiProvider, ApplicationLogQuery, ApplicationLogSource, ChatRef,
        ValidatedApplicationLogQuery,
    },
};
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, ipc::Channel};

use crate::{
    application_logs,
    commands::application_logs::ApplicationLogJobs,
    jobs::{
        ChatLogQueryApproval, ChatPermissionDecision, ChatPermissionDecisionRequest,
        ChatPermissionDetails, GenerationJobStatus, JobControl, JobStore,
    },
    settings::AppState,
};

use super::{
    SERVER, TOOL, provider,
    relay::{Call, read_frame, tool_error, write_frame},
};

const APPROVAL_TIMEOUT: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(50);
const CLOSED: &str = "The log query was cancelled or Ask AI closed.";

pub(crate) struct ChatLogScope {
    pub app: AppHandle,
    pub job_id: String,
    pub reference: ChatRef,
    pub turn_id: String,
    pub provider: AiProvider,
    pub control: JobControl,
    pub events: Channel<GenerationJobStatus>,
}

pub(crate) struct LogBroker {
    _dir: tempfile::TempDir,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    codex_token: Option<String>,
}

impl LogBroker {
    pub fn start(scope: ChatLogScope, command: &mut GenerationCommand) -> io::Result<Self> {
        let dir = tempfile::Builder::new()
            .prefix("qsl-")
            .permissions(Permissions::from_mode(0o700))
            .tempdir_in("/tmp")?;
        let socket = dir.path().join("relay");
        let listener = UnixListener::bind(&socket)?;
        listener.set_nonblocking(true)?;
        let token = uuid::Uuid::new_v4().to_string();
        let suffix = uuid::Uuid::new_v4().simple().to_string();
        let server = format!("{SERVER}_{}", &suffix[..16]);
        provider::configure(command, scope.provider, &server, &socket, &token)?;
        let codex_token = (scope.provider == AiProvider::CodexCli).then(|| token.clone());
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let worker = thread::Builder::new()
            .name("qa-scribe-log-broker".into())
            .spawn(move || {
                scope.serve(listener, &token, &worker_stop);
            })?;
        Ok(Self {
            _dir: dir,
            stop,
            worker: Some(worker),
            codex_token,
        })
    }

    pub fn codex_token(&self) -> Option<&str> {
        self.codex_token.as_deref()
    }
}

impl Drop for LogBroker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Arguments {
    target: String,
    kql: String,
    start: String,
    end: String,
}

impl ChatLogScope {
    fn serve(&self, listener: UnixListener, token: &str, stop: &AtomicBool) {
        while !stop.load(Ordering::Acquire) && !self.control.is_cancelled() {
            let (stream, _) = match listener.accept() {
                Ok(connection) => connection,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(POLL);
                    continue;
                }
                Err(_) => break,
            };
            let _ = self.handle(stream, token, stop);
        }
    }

    fn handle(&self, mut stream: UnixStream, token: &str, stop: &AtomicBool) -> io::Result<()> {
        configure_stream(&stream)?;
        let Some(call) = authorized_call(&mut BufReader::new(&stream), token)? else {
            return Ok(());
        };
        let alive = || {
            !stop.load(Ordering::Acquire) && !self.control.is_cancelled() && peer_waiting(&stream)
        };
        let result = self
            .query(call.arguments, &alive)
            .unwrap_or_else(|error| tool_error(&error));
        write_frame(&mut stream, &result)
    }

    fn sources(&self) -> Vec<ApplicationLogSource> {
        self.app
            .state::<AppState>()
            .with_service(|service| {
                service.chat_log_sources(&self.reference, &self.turn_id, self.provider)
            })
            .unwrap_or_default()
    }

    fn query(&self, args: Value, alive: &dyn Fn() -> bool) -> Result<Value, String> {
        let args: Arguments =
            serde_json::from_value(args).map_err(|_| "Invalid application log query arguments.")?;
        let sources = self.sources();
        let target = sources
            .iter()
            .find(|source| source.label == args.target)
            .ok_or("Choose a configured Application Insights query target.")?;
        let query = ApplicationLogQuery {
            target_id: target.resource_id.clone(),
            kql: args.kql,
            start: args.start,
            end: args.end,
        }
        .validate(&sources)
        .map_err(|error| error.to_string())?;
        self.approve(&query, alive)?;
        if !alive() || !self.sources().contains(&query.target) {
            return Err(CLOSED.into());
        }
        let jobs = self.app.state::<ApplicationLogJobs>();
        let job = jobs
            .register(uuid::Uuid::new_v4())
            .map_err(|error| error.message)?;
        let output = application_logs::run_for_chat(&query, &|| !alive() || job.is_cancelled())
            .map_err(|error| error.message())?;
        let result: Value = serde_json::from_str(&output.result_json)
            .map_err(|_| "The Azure result was invalid.")?;
        let id = self
            .control
            .run_if_not_cancelled(|| {
                if !alive() {
                    return Err(CLOSED.to_owned());
                }
                job.commit(|| {
                    self.app.state::<AppState>().with_service(|service| {
                        service.record_chat_log_capture(
                            &self.reference,
                            &self.turn_id,
                            self.provider,
                            &query,
                            &output,
                        )
                    })
                })
                .map_err(|error| error.message)
            })?
            .ok_or(CLOSED)??;
        let content = json!({
            "captureId": id,
            "target": query.target.label,
            "start": query.start,
            "end": query.end,
            "rowCount": output.row_count,
            "truncated": output.truncated,
            "result": result,
            "portalUrl": output.portal_url
        });
        Ok(json!({"content":[{"type":"text","text":content.to_string()}]}))
    }

    fn approve(
        &self,
        query: &ValidatedApplicationLogQuery,
        alive: &dyn Fn() -> bool,
    ) -> Result<(), String> {
        if !alive() {
            return Err(CLOSED.into());
        }
        let jobs = self.app.state::<JobStore>();
        let details = ChatPermissionDetails {
            can_approve: true,
            provider: self.provider,
            title: "Query application logs".into(),
            tool_name: Some(TOOL.into()),
            server_name: None,
            input_json: None,
            log_query: Some(ChatLogQueryApproval {
                target: query.target.clone(),
                kql: query.kql.clone(),
                start: query.start.clone(),
                end: query.end.clone(),
            }),
        };
        wait_for_approval(
            &jobs,
            &self.job_id,
            &details,
            APPROVAL_TIMEOUT,
            || alive() && self.sources().contains(&query.target),
            |status| {
                let _ = self.events.send(status);
            },
        )
    }
}

fn configure_stream(stream: &UnixStream) -> io::Result<()> {
    // BSD systems can inherit nonblocking mode from the listener.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))
}

fn authorized_call(input: &mut impl BufRead, token: &str) -> io::Result<Option<Call>> {
    let call = read_frame::<Call>(input)?;
    if call.as_ref().is_some_and(|call| call.token != token) {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    Ok(call)
}

fn wait_for_approval(
    jobs: &JobStore,
    job_id: &str,
    details: &ChatPermissionDetails,
    timeout: Duration,
    eligible: impl Fn() -> bool,
    mut notify: impl FnMut(GenerationJobStatus),
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let eligible = || Instant::now() < deadline && eligible();
    let expired = "The log query approval expired or log access changed.";
    let (status, replies) = loop {
        if !eligible() {
            return Err(expired.into());
        }
        if let Some(published) = jobs
            .try_publish_chat_permission(job_id, details.clone())
            .map_err(|error| error.to_string())?
        {
            break published;
        }
        thread::sleep(POLL);
    };
    let Some(request) = &status.pending_permission else {
        return Err(CLOSED.into());
    };
    notify(status.clone());
    while eligible() {
        match replies.recv_timeout(POLL) {
            Ok(reply) if reply.decision == ChatPermissionDecision::Approve && eligible() => {
                return Ok(());
            }
            Ok(reply) if reply.decision == ChatPermissionDecision::Deny => {
                return Err("The tester denied the application log query.".into());
            }
            Ok(_) => break,
            Err(RecvTimeoutError::Disconnected) => return Err(CLOSED.into()),
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
    if let Ok(status) = jobs.decide_chat_permission(ChatPermissionDecisionRequest {
        job_id: status.job_id,
        session_id: status.session_id,
        request_id: request.request_id.clone(),
        provider: request.provider,
        decision: ChatPermissionDecision::Deny,
        additional_request_ids: vec![],
    }) {
        notify(status);
    }
    Err(expired.into())
}

fn peer_waiting(stream: &UnixStream) -> bool {
    let mut byte = 0u8;
    // The relay sends a single request and keeps its write side open while
    // waiting. EOF or extra bytes revoke it. No application payload is read here.
    let read = unsafe {
        libc::recv(
            stream.as_raw_fd(),
            (&mut byte as *mut u8).cast(),
            1,
            libc::MSG_PEEK | libc::MSG_DONTWAIT,
        )
    };
    read < 0 && io::Error::last_os_error().kind() == io::ErrorKind::WouldBlock
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn inherited_nonblocking_mode_does_not_truncate_a_log_response() {
        let (mut socket, peer) = UnixStream::pair().unwrap();
        socket.set_nonblocking(true).unwrap();
        let size: libc::c_int = 4096;
        assert_eq!(
            unsafe {
                libc::setsockopt(
                    socket.as_raw_fd(),
                    libc::SOL_SOCKET,
                    libc::SO_SNDBUF,
                    (&size as *const libc::c_int).cast(),
                    size_of_val(&size) as libc::socklen_t,
                )
            },
            0
        );
        configure_stream(&socket).unwrap();
        peer.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let payload = json!({"result": "x".repeat(72 * 1024)});
        thread::scope(|scope| {
            let reader = scope.spawn(move || {
                thread::sleep(Duration::from_millis(25));
                read_frame::<Value>(&mut BufReader::new(peer))
                    .unwrap()
                    .unwrap()
            });
            let written = write_frame(&mut socket, &payload);
            drop(socket);
            written.unwrap();
            assert_eq!(reader.join().unwrap(), payload);
        });
    }

    #[test]
    fn rejects_a_call_without_the_expected_token() {
        let source = br#"{"token":"wrong","arguments":{}}
"#;
        assert_eq!(
            authorized_call(&mut &source[..], "expected")
                .err()
                .unwrap()
                .kind(),
            io::ErrorKind::PermissionDenied
        );
        assert!(
            authorized_call(&mut &source[..], "wrong")
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn log_approval_waits_for_an_open_provider_permission() {
        let jobs = JobStore::default();
        jobs.insert_generation_job("job".into(), "session".into(), "chat".into())
            .unwrap();
        jobs.mark_running("job", "run".into(), "ready").unwrap();
        let details = ChatPermissionDetails {
            can_approve: true,
            provider: AiProvider::CodexCli,
            title: "Tool request".into(),
            tool_name: None,
            server_name: None,
            input_json: None,
            log_query: None,
        };
        let (first, replies) = jobs
            .try_publish_chat_permission("job", details.clone())
            .unwrap()
            .unwrap();
        let decide = |status: GenerationJobStatus, decision| {
            jobs.decide_chat_permission(ChatPermissionDecisionRequest {
                job_id: status.job_id,
                session_id: status.session_id,
                request_id: status.pending_permission.unwrap().request_id,
                provider: AiProvider::CodexCli,
                decision,
                additional_request_ids: vec![],
            })
            .unwrap();
        };
        thread::scope(|scope| {
            let (send, ready) = std::sync::mpsc::channel();
            let jobs = &jobs;
            let details = &details;
            let worker = scope.spawn(move || {
                wait_for_approval(
                    jobs,
                    "job",
                    details,
                    Duration::from_secs(2),
                    || true,
                    |status| send.send(status).unwrap(),
                )
            });
            assert!(matches!(
                ready.recv_timeout(POLL * 2),
                Err(RecvTimeoutError::Timeout)
            ));
            decide(first, ChatPermissionDecision::Deny);
            assert_eq!(
                replies.try_recv().unwrap().decision,
                ChatPermissionDecision::Deny
            );
            decide(
                ready.recv_timeout(Duration::from_secs(1)).unwrap(),
                ChatPermissionDecision::Approve,
            );
            worker.join().unwrap().unwrap();
        });
    }

    #[test]
    fn approval_loses_authority_on_setting_change_or_expiry() {
        let details = ChatPermissionDetails {
            can_approve: true,
            provider: AiProvider::CodexCli,
            title: "Application log approval".into(),
            tool_name: None,
            server_name: None,
            input_json: None,
            log_query: None,
        };
        for revoke in [true, false] {
            let jobs = JobStore::default();
            jobs.insert_generation_job("job".into(), "session".into(), "chat".into())
                .unwrap();
            jobs.mark_running("job", "run".into(), "ready").unwrap();
            let enabled = Cell::new(true);
            let mut events = vec![];
            let denied = wait_for_approval(
                &jobs,
                "job",
                &details,
                Duration::from_millis(100),
                || enabled.get(),
                |status| {
                    let active = status.pending_permission.is_some();
                    events.push(active);
                    if revoke && active {
                        enabled.set(false);
                    }
                },
            );
            assert!(
                denied
                    .unwrap_err()
                    .contains("expired or log access changed")
            );
            assert_eq!(events, [true, false]);
            assert!(jobs.status("job").unwrap().pending_permission.is_none());
        }
    }
}
