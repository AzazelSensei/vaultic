#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O vaultic-auth-helper.swift -o vaultic-auth-helper
echo "built: $(pwd)/vaultic-auth-helper"
codesign -dv vaultic-auth-helper 2>&1 | head -2
echo "install: copy to ~/.config/vaultic/vaultic-auth-helper (or let install.sh do it)"
