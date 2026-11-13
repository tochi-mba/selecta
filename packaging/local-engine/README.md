# Selecta Local Engine install and service launchers (LF01)

Both supplied launchers are explicitly user-scoped. First install the Selecta
Python 3.12 package and FFmpeg on the same local device. There is no signed
installer or signing infrastructure in this PR.

## Windows first

With Selecta available on PATH, run the local file
packaging/local-engine/windows/install.ps1 in PowerShell. It registers a per-user
Scheduled Task on login that runs selecta engine run. Commands for manual
operation are selecta engine start, status, stop and restart.

This is not an elevated Windows Service; the launcher runs only while that
Windows user is logged on. Use the -Uninstall parameter to remove its task.
Uninstall does not delete Selecta data or engine state.

Detecting a waveOut device is NOT proof that sound is actually being produced.
A hardware output confirmation integration is a separate launch gate.

## Linux venue

Install Selecta in a user-scoped venv at ~/.local/bin/selecta, or update
ExecStart in the systemd unit to the actual absolute binary. Run
sh packaging/local-engine/linux/install.sh, then inspect
systemctl --user status selecta-engine and
journalctl --user -u selecta-engine. On headless venues an administrator must
approve enabling lingering for the dedicated venue user; not automatic here.
Ensure the service account has access to the intended ALSA/PipeWire device.

## macOS

Configuration and metadata discovery work on macOS, but no validated CoreAudio
output probe, signed installer, launchd supervision or tested playback support
exists. Its capability report is unsupported and never audio-ready. Do not
advertise production playback parity until signed packaging, device access and
hardware tests are independently verified.

## Updates

The Python update module verifies Ed25519 manifests against caller-provisioned
trusted public keys and SHA-256 package bytes. It can stage immutable artifacts,
record activation intent and revert that intent. The shipped keyring is EMPTY,
so all updates fail closed. No network downloader, signing private key,
platform binary switcher or operational rollback is included. Never claim an
update installed or audio-safe based only on staged metadata.
