# vaultic Touch ID approval helper

A tiny Swift binary the broker execs to require Touch ID approval before revealing a credential. It is invoked with one argument (the reason string); the broker's `TouchIdApprover` maps exit `0` → `approved` and every other exit code → `denied` (fail-safe). Build it with `bash build.sh`, then copy the compiled `vaultic-auth-helper` to `~/.config/vaultic/vaultic-auth-helper` (the path the broker expects), or let `install.sh` do the copy. The compiled binary is gitignored — only the source and `build.sh` are committed.
