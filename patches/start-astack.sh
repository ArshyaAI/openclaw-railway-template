#!/usr/bin/env bash
set -euo pipefail

restore_persisted_crons() {
  local source_dir="/data/.openclaw/cron/system"
  [ -d "$source_dir" ] || return 0

  while IFS= read -r cron_file; do
    local name
    name="$(basename "$cron_file")"
    case "$name" in
      ""|*[^A-Za-z0-9_.-]*)
        echo "[start-astack] skipping invalid cron file name: $name" >&2
        continue
        ;;
    esac
    cp "$cron_file" "/etc/cron.d/$name"
    chmod 0644 "/etc/cron.d/$name"
    echo "[start-astack] restored cron file /etc/cron.d/$name"
  done < <(find "$source_dir" -maxdepth 1 -type f | sort)
}

start_cron() {
  if command -v service >/dev/null 2>&1; then
    service cron start >/dev/null 2>&1 || true
  fi
  if ! pgrep -x cron >/dev/null 2>&1; then
    cron >/dev/null 2>&1 || true
  fi
}

restore_persisted_crons
start_cron

exec alphaclaw start
