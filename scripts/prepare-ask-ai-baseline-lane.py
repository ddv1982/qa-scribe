import argparse
import hashlib
import json
import os
import pathlib
import shlex
import shutil
import subprocess


ROOT = pathlib.Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare a private native lane and print its parent-owned invocation. Never launch an app.")
    parser.add_argument("directory", type=pathlib.Path)
    parser.add_argument("--fixture", type=pathlib.Path, required=True)
    parser.add_argument("--binary", type=pathlib.Path, required=True)
    parser.add_argument("--binary-sha256", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--side", choices=["baseline", "head"], required=True)
    parser.add_argument("--input-reference", type=pathlib.Path)
    parser.add_argument("--driver-executor", type=pathlib.Path)
    args = parser.parse_args()
    node = shutil.which("node")
    bun = shutil.which("bun")
    assert node and bun, "Put the pinned Node and Bun executables on PATH"
    assert subprocess.check_output([node, "--version"], text=True).strip().startswith("v24."), "Use Node 24 for comparable runs"
    assert subprocess.check_output([bun, "--version"], text=True).strip() == "1.3.5", "Use repository-pinned Bun 1.3.5"
    node_bin = str(pathlib.Path(node).parent)
    bun_bin = str(pathlib.Path(bun).parent)
    lane = args.directory.resolve()
    fixture = args.fixture.resolve()
    binary = args.binary.resolve()
    assert not lane.exists(), "Use a new private lane directory"
    assert args.side != "head" or args.input_reference, "Head requires a qualified v2 baseline input-provenance reference"
    cargo_root = pathlib.Path(os.environ.get("CARGO_HOME", pathlib.Path.home() / ".cargo"))
    executors = [args.driver_executor.resolve()] if args.driver_executor else list((cargo_root / "registry/src").glob("*/tauri-plugin-wdio-webdriver-1.2.0/src/platform/executor.rs"))
    assert len(executors) == 1, "Select the built embedded driver source explicitly with --driver-executor"
    executor = executors[0]
    assert "el.click();" in executor.read_text() and "document.execCommand('insertText'" in executor.read_text()
    reference = None
    if args.input_reference:
        reference = json.loads(args.input_reference.read_text())
        assert reference["schema"] == "qa-scribe-ask-ai-conversations-performance-v2"
        assert reference["side"] == "baseline" and reference["completed"] and reference["commonScopeComplete"]
        assert reference["failures"] == 0 and reference["inputProvenance"]["metric"] == "dom-action-to-ready-v2"
        driver = reference["inputProvenance"]["driver"]
        for key, path in {"executorSha256": executor, "serviceSha256": ROOT / "frontend/node_modules/@wdio/tauri-service/dist/esm/index.js", "observerSha256": ROOT / "e2e/specs/ui-performance-observer.mjs", "probeSha256": ROOT / "e2e/specs/ask-ai-conversations.benchmark.mjs"}.items():
            assert driver[key] == hashlib.sha256(path.read_bytes()).hexdigest(), f"Input implementation differs from baseline for {key}"
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() == args.revision
    subprocess.run(["git", "diff", "--quiet", "HEAD"], cwd=ROOT, check=True)
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    assert digest == args.binary_sha256
    manifest = json.loads((fixture / "ask-ai-isolation-fixture.json").read_text())
    assert hashlib.sha256((fixture / "qa-scribe.sqlite").read_bytes()).hexdigest() == manifest["databaseSha256"]
    subprocess.run(["python3", str(ROOT / "scripts/prepare-ask-ai-baseline.py"), "verify", str(fixture)], check=True, stdout=subprocess.DEVNULL)
    lane.mkdir(parents=True)
    shutil.copytree(fixture, lane / "app-data")
    executable = ROOT / "target/debug/qa-scribe-tauri"
    executable.parent.mkdir(parents=True, exist_ok=True)
    if executable.resolve() != binary:
        shutil.copy2(binary, executable)
    assert hashlib.sha256(executable.read_bytes()).hexdigest() == digest
    environment = {
        "QA_SCRIBE_E2E_SPEC": "ask-ai-conversations.benchmark.mjs",
        "QA_SCRIBE_E2E_SKIP_BUILD": "1",
        "QA_SCRIBE_E2E_TEMP_ROOT": str(lane),
        "QA_SCRIBE_E2E_ARTIFACTS": str(lane / "artifacts"),
        "QA_SCRIBE_E2E_BENCHMARK_REVISION": args.revision,
        "QA_SCRIBE_E2E_BENCHMARK_BUILD_MODE": "release-production-e2e",
        "QA_SCRIBE_UI_PERF_SIDE": args.side,
        "QA_SCRIBE_UI_PERF_DRIVER_EXECUTOR": str(executor),
    }
    if reference:
        reference_path = lane / "input-reference.json"
        shutil.copy2(args.input_reference, reference_path)
        environment["QA_SCRIBE_UI_PERF_INPUT_REFERENCE"] = str(reference_path)
    command = " ".join(f"{name}={shlex.quote(value)}" for name, value in environment.items())
    command = f'PATH={shlex.quote(bun_bin + ":" + node_bin)}:"$PATH" QA_SCRIBE_UI_PERF_LANE_RELEASED=1 ' + command + f" {shlex.quote(str(pathlib.Path(node)))} scripts/run-e2e.mjs"
    receipt = {"schema": "qa-scribe-ask-ai-baseline-lane-preparation-v1", "nativeRun": False,
               "workingDirectory": str(ROOT), "binarySha256": digest,
               "fixtureDatabaseSha256": manifest["databaseSha256"], "environment": environment,
               "parentInvocationAfterLaneRelease": command}
    (lane / "lane-preparation.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(command)
