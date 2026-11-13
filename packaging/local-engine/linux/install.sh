#!/usr/bin/env sh
set -eu
# User service only; never install a root media service.
case "${1:-}" in
  --remove)
    systemctl --user disable --now selecta-engine.service || true
    rm -f "$HOME/.config/systemd/user/selecta-engine.service"
    systemctl --user daemon-reload
    ;;
  "")
    command -v systemctl >/dev/null
    dest="$HOME/.config/systemd/user"
    mkdir -p "$dest"
    cp "$(dirname "$0")/selecta-engine.service" "$dest/selecta-engine.service"
    systemctl --user daemon-reload
    systemctl --user enable --now selecta-engine.service
    ;;
  *) echo "Usage: $0 [--remove]" >&2; exit 2 ;;
esac
