#!/usr/bin/env bash
set -euo pipefail

if [ "${RUNNER_ENVIRONMENT:-}" != github-hosted ]; then
  echo 'Rust toolchain normalization skipped outside GitHub-hosted runners.'
  exit 0
fi

pinned="${PINNED_RUST_TOOLCHAIN:?Expected the exact project Rust pin}"
active="$(rustup show active-toolchain)"
active="${active%% *}"
host="$(rustc -vV | sed -n 's/^host: //p')"
if [ -z "$host" ] || [ "$active" != "$pinned-$host" ]; then
  echo "Expected active Rust toolchain $pinned-$host, found $active." >&2
  exit 1
fi

rustup default "$active"
installed="$(rustup toolchain list --quiet)"
while IFS=' ' read -r toolchain _; do
  if [ -n "$toolchain" ] && [ "$toolchain" != "$active" ]; then
    rustup toolchain uninstall "$toolchain"
  fi
done <<< "$installed"

rustup toolchain list --quiet
rustc -vV
