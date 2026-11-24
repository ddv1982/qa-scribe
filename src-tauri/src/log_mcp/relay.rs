use std::{
    io::{self, BufRead, BufReader, Read, Write},
    net::Shutdown,
    os::unix::net::UnixStream,
    path::Path,
    sync::mpsc::{self, Receiver, RecvTimeoutError, TryRecvError},
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{TOKEN_ENV, TOOL};
pub(super) const FRAME_BYTES: u64 = 128 * 1024;
pub(super) const TOOL_TIMEOUT_SECS: u64 = 150;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Call {
    pub token: String,
    pub arguments: Value,
}

pub(super) fn run(socket: &Path) -> io::Result<()> {
    let token = std::env::var(TOKEN_ENV)
        .ok()
        .filter(|token| !token.is_empty())
        .ok_or(io::ErrorKind::PermissionDenied)?;
    let (sender, input) = mpsc::sync_channel(8);
    thread::spawn(move || {
        let mut stdin = io::stdin().lock();
        loop {
            match read_frame(&mut stdin) {
                Ok(Some(request)) => {
                    if sender.send(Ok(request)).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = sender.send(Err(error));
                    return;
                }
                _ => return,
            }
        }
    });
    serve(input, io::stdout().lock(), |id, arguments| {
        InFlight::open(socket, &token, id, arguments)
    })
}

struct InFlight {
    id: Value,
    stream: UnixStream,
    result: Receiver<Value>,
}

impl InFlight {
    fn open(socket: &Path, token: &str, id: Value, arguments: Value) -> io::Result<Self> {
        let mut stream = UnixStream::connect(socket)?;
        stream.set_write_timeout(Some(Duration::from_secs(2)))?;
        stream.set_read_timeout(Some(Duration::from_secs(TOOL_TIMEOUT_SECS - 5)))?;
        write_frame(
            &mut stream,
            &Call {
                token: token.into(),
                arguments,
            },
        )?;
        let read = stream.try_clone()?;
        let (send, result) = mpsc::sync_channel(1);
        thread::Builder::new().spawn(move || {
            let reply = read_frame(&mut BufReader::new(read))
                .ok()
                .flatten()
                .unwrap_or_else(expired);
            let _ = send.send(reply);
        })?;
        Ok(Self { id, stream, result })
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        let _ = self.stream.shutdown(Shutdown::Both);
    }
}

fn expired() -> Value {
    tool_error("The application log request expired or Ask AI closed.")
}

pub(super) fn read_frame<T: serde::de::DeserializeOwned>(
    reader: &mut impl BufRead,
) -> io::Result<Option<T>> {
    let mut frame = Vec::new();
    let size = reader.take(FRAME_BYTES + 1).read_until(b'\n', &mut frame)?;
    if size == 0 {
        return Ok(None);
    }
    if size as u64 > FRAME_BYTES || frame.last() != Some(&b'\n') {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok(Some(serde_json::from_slice(&frame)?))
}

pub(super) fn write_frame(writer: &mut impl Write, value: &impl Serialize) -> io::Result<()> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.len() as u64 >= FRAME_BYTES {
        return Err(io::ErrorKind::InvalidData.into());
    }
    writer.write_all(&bytes)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

pub(super) fn tool_error(message: &str) -> Value {
    json!({"content":[{"type":"text","text":message}],"isError":true})
}

fn serve(
    input: Receiver<io::Result<Value>>,
    mut output: impl Write,
    mut forward: impl FnMut(Value, Value) -> io::Result<InFlight>,
) -> io::Result<()> {
    let mut initialized = false;
    let mut pending: Option<InFlight> = None;
    loop {
        let incoming = if pending.is_some() {
            input.recv_timeout(Duration::from_millis(25))
        } else {
            input.recv().map_err(|_| RecvTimeoutError::Disconnected)
        };
        let request = match incoming {
            Ok(request) => request?,
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
            Err(RecvTimeoutError::Timeout) => {
                if let Some(call) = &pending {
                    let result = match call.result.try_recv() {
                        Ok(result) => result,
                        Err(TryRecvError::Disconnected) => expired(),
                        Err(TryRecvError::Empty) => continue,
                    };
                    reply(&mut output, &call.id, result)?;
                    pending = None;
                }
                continue;
            }
        };
        let method = request["method"].as_str().unwrap_or_default();
        let params = &request["params"];
        let Some(id) = request.get("id") else {
            if method == "notifications/cancelled"
                && pending
                    .as_ref()
                    .is_some_and(|call| params["requestId"] == call.id)
            {
                pending = None;
            }
            continue;
        };
        let result = match method {
            "initialize" => {
                initialized = true;
                let version = params["protocolVersion"]
                    .as_str()
                    .filter(|version| {
                        matches!(
                            *version,
                            "2024-11-05" | "2025-03-26" | "2025-06-18" | "2025-11-25"
                        )
                    })
                    .unwrap_or("2025-03-26");
                json!({"protocolVersion":version,"capabilities":{"tools":{}},
                    "serverInfo":{"name":"QA Scribe Application Logs","version":env!("CARGO_PKG_VERSION")}})
            }
            "ping" => json!({}),
            "tools/list" if initialized => tools(),
            "tools/call" if initialized && params["name"].as_str() == Some(TOOL) => {
                if pending.is_some() {
                    tool_error("Wait for the current application log query to finish.")
                } else {
                    match forward(id.clone(), params["arguments"].clone()) {
                        Ok(call) => {
                            pending = Some(call);
                            continue;
                        }
                        Err(_) => expired(),
                    }
                }
            }
            _ => {
                write_frame(
                    &mut output,
                    &json!({"jsonrpc":"2.0","id":id,
                    "error":{"code":-32601,"message":"Unknown MCP method or tool"}}),
                )?;
                continue;
            }
        };
        reply(&mut output, id, result)?;
    }
}

fn reply(output: &mut impl Write, id: &Value, result: Value) -> io::Result<()> {
    write_frame(output, &json!({"jsonrpc":"2.0","id":id,"result":result}))
}

fn tools() -> Value {
    json!({"tools":[{
        "name":TOOL,
        "description":"Read Application Insights logs after the tester approves this exact query in QA Scribe. Prefer queries that summarize results.",
        "inputSchema":{"type":"object","additionalProperties":false,
            "required":["target","kql","start","end"],
            "properties":{
                "target":{"type":"string","description":"Exact configured primary target label"},
                "kql":{"type":"string","description":"Kusto query to show the tester"},
                "start":{"type":"string","description":"Absolute RFC 3339 UTC start"},
                "end":{"type":"string","description":"Absolute RFC 3339 UTC end"}
            }
        },
        "annotations":{"readOnlyHint":true,"openWorldHint":true}
    }]})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_one_tool_and_only_forwards_an_initialized_tool_call() {
        let input = br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"query_application_logs"}}
{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":"list","method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"query_application_logs","arguments":{"target":"acceptance"}}}
"#;
        let mut output = vec![];
        let mut calls = vec![];
        let (sender, frames) = mpsc::channel();
        let mut input = &input[..];
        while let Some(request) = read_frame(&mut input).unwrap() {
            sender.send(Ok(request)).unwrap();
        }
        drop(sender);
        serve(frames, &mut output, |_, args| {
            calls.push(args);
            Err(io::ErrorKind::ConnectionRefused.into())
        })
        .unwrap();
        let replies: Vec<Value> = output
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice(line).unwrap())
            .collect();
        assert_eq!(replies[0]["error"]["code"], -32601);
        assert_eq!(replies[1]["result"]["protocolVersion"], "2025-11-25");
        assert_eq!(replies[2]["id"], "list");
        assert_eq!(replies[2]["result"]["tools"].as_array().unwrap().len(), 1);
        assert_eq!(replies[2]["result"]["tools"][0]["name"], TOOL);
        assert_eq!(calls, [json!({"target":"acceptance"})]);
    }

    #[test]
    fn cancellation_closes_the_pending_socket() {
        let (sender, input) = mpsc::channel();
        for request in [
            json!({"id":1,"method":"initialize"}),
            json!({"id":2,"method":"tools/call","params":{"name":TOOL,"arguments":{}}}),
            json!({"method":"notifications/cancelled","params":{"requestId":2}}),
            json!({"id":3,"method":"tools/call","params":{"name":TOOL,"arguments":{}}}),
        ] {
            sender.send(Ok(request)).unwrap();
        }
        drop(sender);
        let (mut broker, stream) = UnixStream::pair().unwrap();
        broker
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let (_send, result) = mpsc::channel();
        let mut call = Some(InFlight {
            id: json!(2),
            stream,
            result,
        });
        let mut second_call = false;
        serve(input, Vec::new(), |id, _| {
            if id == json!(2) {
                Ok(call.take().unwrap())
            } else {
                assert_eq!(broker.read(&mut [0]).unwrap(), 0);
                second_call = true;
                Err(io::ErrorKind::ConnectionRefused.into())
            }
        })
        .unwrap();
        assert!(second_call);
    }

    #[test]
    fn rejects_oversized_or_unterminated_frames() {
        assert!(read_frame::<Value>(&mut &vec![b' '; FRAME_BYTES as usize + 1][..]).is_err());
        assert!(read_frame::<Value>(&mut &b"{}"[..]).is_err());
    }
}
