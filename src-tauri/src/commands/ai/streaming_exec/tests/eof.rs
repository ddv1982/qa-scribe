use super::*;

#[test]
fn stdout_eof_allows_successful_process_shutdown() {
    let cli = FakeCli::new(
        "fake-delayed-exit",
        "#!/bin/sh\ncat >/dev/null\nprintf 'answer\\n'\nexec 1>&-\nsleep 0.2\nprintf 'shutdown complete' >&2\nexit 0\n",
    );
    let command = cli.command("prompt".into(), GenerationOutputFormat::PlainText);
    let output = run_bounded(Duration::from_secs(5), move || {
        run_generation_command_streaming(&command, &JobControl::default(), |_| {})
    })
    .expect("normal shutdown completes");
    assert!(output.success(), "provider must exit naturally: {output:?}");
    assert_eq!(output.stderr, b"shutdown complete");
}

#[test]
fn stdout_eof_preserves_nonzero_exit_and_stderr() {
    let cli = FakeCli::new(
        "fake-delayed-failure",
        "#!/bin/sh\ncat >/dev/null\nprintf 'answer\\n'\nexec 1>&-\nsleep 0.2\nprintf 'shutdown failed' >&2\nexit 7\n",
    );
    let command = cli.command("prompt".into(), GenerationOutputFormat::PlainText);
    let output = run_bounded(Duration::from_secs(5), move || {
        run_generation_command_streaming(&command, &JobControl::default(), |_| {})
    })
    .expect("failure is returned without deadlock");
    assert!(!output.success());
    assert_eq!(output.stderr, b"shutdown failed");
}

#[test]
fn cancel_after_stdout_eof_kills_process_group() {
    let cli = FakeCli::new(
        "fake-eof-cancel",
        "#!/bin/sh\ncat >/dev/null\nprintf 'answer\\n'\nexec 1>&-\nsleep 120 &\nsleeper=$!\nprintf '%s' \"$sleeper\" >\"$1\"\nwait \"$sleeper\"\n",
    );
    let marker = cli.dir.join("stdout-closed");
    let mut command = cli.command("prompt".into(), GenerationOutputFormat::PlainText);
    command.args.push(marker.to_string_lossy().into_owned());
    let control = JobControl::default();
    let cancellation = control.clone();
    let (tx, rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        let _ = tx.send(run_generation_command_streaming(&command, &control, |_| {}));
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    while !marker.exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    let closed = marker.exists();
    cancellation.request_cancel().expect("cancel accepted");
    let output = rx
        .recv_timeout(Duration::from_secs(1))
        .expect("cancellation must settle before the two-second EOF fallback")
        .expect("cancel returns output");
    worker.join().expect("worker settles");
    assert!(
        closed,
        "provider must stay alive long enough to signal stdout closure"
    );
    assert!(output.cancelled);
}
