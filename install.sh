#!/usr/bin/env bash
set -euo pipefail

# vaultic installer — idempotent, safe to re-run.
# Usage: ./install.sh [--dry-run] [--force]
#   --dry-run  : print what WOULD change, write nothing
#   --force    : overwrite ~/.claude/skills/vaultic/SKILL.md when it differs

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

readonly MIN_NODE_MAJOR=20
readonly MIN_NODE_MINOR=10
readonly LOCAL_BIN="$HOME/.local/bin"
readonly CLI_ENTRY="$REPO/packages/cli/dist/index.js"
readonly BROKER_ENTRY="$REPO/packages/broker/dist/server.js"
readonly CLAUDE_SETTINGS="$HOME/.claude/settings.json"
readonly CODEX_DIR="$HOME/.codex"
readonly CODEX_HOOKS="$CODEX_DIR/hooks.json"
readonly SKILL_SRC="$REPO/skill/vaultic"
readonly SKILL_DEST="$HOME/.claude/skills/vaultic"
readonly HELPER_SRC="$REPO/helpers/touchid/vaultic-auth-helper"
readonly HELPER_DEST_DIR="$HOME/.config/vaultic"
readonly HELPER_DEST="$HELPER_DEST_DIR/vaultic-auth-helper"
readonly PRE_HOOK_CMD="node $REPO/hooks/vaultic-pretooluse.mjs"
readonly SS_HOOK_CMD="node $REPO/hooks/vaultic-sessionstart.mjs"
readonly PRE_HOOK_MARKER="vaultic-pretooluse.mjs"
readonly SS_HOOK_MARKER="vaultic-sessionstart.mjs"
readonly PRE_HOOK_MATCHER="Write|Edit|Bash"

# Idempotent merge: append each vaultic hook only if no existing command
# already references its marker file.
# shellcheck disable=SC2016  # $pre_cmd etc. are jq --arg variables, not shell
readonly HOOKS_MERGE_FILTER='
  .hooks //= {}
  | .hooks.PreToolUse //= []
  | .hooks.SessionStart //= []
  | (if ([.hooks.PreToolUse[] | .hooks[]? | (.command // "") | contains($pre_marker)] | any)
     then .
     else .hooks.PreToolUse += [{matcher: $pre_matcher, hooks: [{type: "command", command: $pre_cmd, timeout: 10}]}]
     end)
  | (if ([.hooks.SessionStart[] | .hooks[]? | (.command // "") | contains($ss_marker)] | any)
     then .
     else .hooks.SessionStart += [{hooks: [{type: "command", command: $ss_cmd, timeout: 5}]}]
     end)
'

DRY_RUN=0
FORCE=0

info() { printf '\033[1;34m[vaultic]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[uyarı]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[hata]\033[0m %s\n' "$*" >&2; }
dry()  { printf '\033[1;36m[dry-run]\033[0m %s\n' "$*"; }

die() { err "$*"; exit 1; }

usage() {
  cat <<'EOF'
vaultic installer — idempotent, safe to re-run.
Usage: ./install.sh [--dry-run] [--force]
  --dry-run  : print what WOULD change, write nothing
  --force    : overwrite ~/.claude/skills/vaultic/SKILL.md when it differs
EOF
}

parse_args() {
  for arg in "$@"; do
    case "$arg" in
      --dry-run) DRY_RUN=1 ;;
      --force)   FORCE=1 ;;
      -h|--help) usage; exit 0 ;;
      *)         die "bilinmeyen argüman: $arg (kullanım: ./install.sh [--dry-run] [--force])" ;;
    esac
  done
}

# ---------------------------------------------------------------- preflight

check_node() {
  command -v node >/dev/null 2>&1 \
    || die "node bulunamadı. Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} kur: https://nodejs.org veya 'nvm install 20'"
  local version major minor
  version="$(node --version)"
  version="${version#v}"
  major="${version%%.*}"
  minor="${version#*.}"; minor="${minor%%.*}"
  if (( major < MIN_NODE_MAJOR )) || { (( major == MIN_NODE_MAJOR )) && (( minor < MIN_NODE_MINOR )); }; then
    die "node v$version çok eski; en az v${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} gerekli. 'nvm install 20' veya https://nodejs.org"
  fi
  info "node v$version OK"
}

check_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    if (( DRY_RUN )); then
      dry "pnpm bulunamadı; çalıştırılacak: corepack enable pnpm"
      return 0
    fi
    warn "pnpm bulunamadı, corepack ile etkinleştirmeyi deniyorum..."
    corepack enable pnpm >/dev/null 2>&1 || true
  fi
  command -v pnpm >/dev/null 2>&1 \
    || die "pnpm kurulamadı. Elle kur: 'corepack enable pnpm' veya 'npm install -g pnpm'"
  info "pnpm $(pnpm --version) OK"
}

check_jq() {
  command -v jq >/dev/null 2>&1 \
    || die "jq bulunamadı; settings.json birleştirmesi için zorunlu. Kur: 'brew install jq'"
  info "jq $(jq --version) OK"
}

preflight() {
  info "== Ön kontrol =="
  check_node
  check_pnpm
  check_jq
}

# -------------------------------------------------------------------- build

build_packages() {
  info "== Build =="
  if (( DRY_RUN )); then
    dry "çalıştırılacak: pnpm install --frozen-lockfile || pnpm install; pnpm build"
    return
  fi
  cd "$REPO"
  pnpm install --frozen-lockfile || pnpm install
  pnpm build
  [[ -f "$CLI_ENTRY" ]]    || die "build sonrası $CLI_ENTRY yok — 'pnpm build' çıktısını kontrol et"
  [[ -f "$BROKER_ENTRY" ]] || die "build sonrası $BROKER_ENTRY yok — 'pnpm build' çıktısını kontrol et"
  chmod +x "$CLI_ENTRY" "$BROKER_ENTRY"
  info "build tamam"
}

# -------------------------------------------------------------- CLI symlink

link_cli() {
  info "== CLI symlink =="
  local link="$LOCAL_BIN/vaultic"
  if [[ -L "$link" && "$(readlink "$link")" == "$CLI_ENTRY" ]]; then
    info "symlink zaten doğru: $link -> $CLI_ENTRY"
  elif (( DRY_RUN )); then
    dry "oluşturulacak: $link -> $CLI_ENTRY"
  else
    mkdir -p "$LOCAL_BIN"
    ln -sfn "$CLI_ENTRY" "$link"
    info "symlink kuruldu: $link -> $CLI_ENTRY"
  fi
  case ":$PATH:" in
    *":$LOCAL_BIN:"*) ;;
    *) warn "$LOCAL_BIN PATH'te değil. Shell profiline ekle: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
}

# ------------------------------------------------------ hooks merge (shared)

# merge_hooks_into <settings_file> <label>
# Merges the two vaultic hooks into the given JSON file. Backs up, validates
# with jq, writes atomically. Skips cleanly when both hooks already present.
merge_hooks_into() {
  local settings_file="$1" label="$2"
  local current merged

  if [[ -f "$settings_file" ]]; then
    jq -e . "$settings_file" >/dev/null \
      || die "$settings_file geçerli JSON değil — elle düzelt, sonra tekrar çalıştır"
    current="$(cat "$settings_file")"
  else
    current='{}'
  fi

  merged="$(printf '%s' "$current" | jq \
    --arg pre_cmd "$PRE_HOOK_CMD" \
    --arg ss_cmd "$SS_HOOK_CMD" \
    --arg pre_marker "$PRE_HOOK_MARKER" \
    --arg ss_marker "$SS_HOOK_MARKER" \
    --arg pre_matcher "$PRE_HOOK_MATCHER" \
    "$HOOKS_MERGE_FILTER")"

  if [[ "$merged" == "$current" ]]; then
    info "$label: vaultic hook'ları zaten kayıtlı, değişiklik yok"
    return
  fi

  local pre_present ss_present
  pre_present="$(printf '%s' "$current" | jq --arg m "$PRE_HOOK_MARKER" \
    '[.hooks.PreToolUse[]? | .hooks[]? | (.command // "") | contains($m)] | any')"
  ss_present="$(printf '%s' "$current" | jq --arg m "$SS_HOOK_MARKER" \
    '[.hooks.SessionStart[]? | .hooks[]? | (.command // "") | contains($m)] | any')"

  if (( DRY_RUN )); then
    if [[ "$pre_present" == "false" ]]; then dry "$label: PreToolUse hook eklenecek ($PRE_HOOK_CMD)"; fi
    if [[ "$ss_present" == "false" ]]; then dry "$label: SessionStart hook eklenecek ($SS_HOOK_CMD)"; fi
    return 0
  fi

  mkdir -p "$(dirname "$settings_file")"
  if [[ -f "$settings_file" ]]; then
    local backup
    backup="${settings_file}.vaultic-bak.$(date +%Y%m%d%H%M%S)"
    cp "$settings_file" "$backup"
    info "$label: yedek alındı -> $backup"
  fi

  local tmp
  tmp="$(mktemp "${settings_file}.tmp.XXXXXX")"
  printf '%s\n' "$merged" > "$tmp"
  if ! jq -e . "$tmp" >/dev/null; then
    rm -f "$tmp"
    die "$label: birleştirme sonucu geçersiz JSON üretti, dosyaya dokunulmadı"
  fi
  mv "$tmp" "$settings_file"
  if [[ "$pre_present" == "false" ]]; then info "$label: PreToolUse hook eklendi"; fi
  if [[ "$ss_present" == "false" ]]; then info "$label: SessionStart hook eklendi"; fi
}

install_claude_hooks() {
  info "== Claude Code hook'ları =="
  merge_hooks_into "$CLAUDE_SETTINGS" "claude"
}

# -------------------------------------------------------------------- skill

install_skill() {
  info "== Skill =="
  local dest_md="$SKILL_DEST/SKILL.md"
  local src_md="$SKILL_SRC/SKILL.md"

  if [[ -f "$dest_md" ]] && ! diff -q "$src_md" "$dest_md" >/dev/null; then
    if (( FORCE )); then
      if (( DRY_RUN )); then
        dry "skill farklı, --force ile üzerine yazılacak: $SKILL_DEST"
      else
        cp -R "$SKILL_SRC/." "$SKILL_DEST/"
        info "skill üzerine yazıldı (--force): $SKILL_DEST"
      fi
    else
      warn "mevcut $dest_md repodakinden farklı — fark:"
      diff -u "$dest_md" "$src_md" || true
      warn "üzerine yazmak için --force ile tekrar çalıştır. Şimdilik ATLANDI."
    fi
    return
  fi

  if [[ -f "$dest_md" ]]; then
    info "skill zaten güncel: $SKILL_DEST"
  elif (( DRY_RUN )); then
    dry "kopyalanacak: $SKILL_SRC -> $SKILL_DEST"
  else
    mkdir -p "$SKILL_DEST"
    cp -R "$SKILL_SRC/." "$SKILL_DEST/"
    info "skill kopyalandı: $SKILL_DEST"
  fi
}

# ------------------------------------------------------------- MCP register

register_mcp() {
  info "== MCP broker kaydı =="
  if ! command -v claude >/dev/null 2>&1; then
    warn "claude CLI bulunamadı. Elle ekle (.mcp.json veya 'claude mcp add'):"
    cat <<EOF
  {
    "mcpServers": {
      "vaultic": {
        "command": "node",
        "args": ["$BROKER_ENTRY"]
      }
    }
  }
EOF
    return
  fi
  if (( DRY_RUN )); then
    dry "çalıştırılacak: claude mcp add vaultic --scope user -- node $BROKER_ENTRY (zaten kayıtlıysa atlanır)"
    return
  fi
  if claude mcp list 2>/dev/null | grep -q '^vaultic[: ]'; then
    info "MCP 'vaultic' zaten kayıtlı, atlanıyor"
  else
    claude mcp add vaultic --scope user -- node "$BROKER_ENTRY"
    info "MCP 'vaultic' kaydedildi (user scope)"
  fi
}

# --------------------------------------------------------- Touch ID helper

install_touchid_helper() {
  info "== Touch ID yardımcısı =="
  if [[ "$(uname -s)" != "Darwin" ]]; then
    info "macOS değil, atlanıyor"
    return
  fi
  if ! command -v swiftc >/dev/null 2>&1; then
    warn "swiftc yok — Touch ID yardımcısı derlenemedi. Kur: 'xcode-select --install', sonra install.sh'ı tekrar çalıştır."
    return
  fi
  if (( DRY_RUN )); then
    dry "çalıştırılacak: bash helpers/touchid/build.sh; kopyalanacak: $HELPER_DEST (dizin 700, binary 755)"
    return
  fi
  bash "$REPO/helpers/touchid/build.sh"
  mkdir -p "$HELPER_DEST_DIR"
  chmod 700 "$HELPER_DEST_DIR"
  cp "$HELPER_SRC" "$HELPER_DEST"
  chmod 755 "$HELPER_DEST"
  info "yardımcı kuruldu: $HELPER_DEST"
}

# -------------------------------------------------------------------- Codex

install_codex_hooks() {
  info "== Codex hook'ları =="
  if [[ ! -d "$CODEX_DIR" ]]; then
    info "$CODEX_DIR yok, atlanıyor"
    return
  fi
  merge_hooks_into "$CODEX_HOOKS" "codex"
  info "Not: Codex'te hookSpecificOutput.permissionDecision 'ask' DESTEKLENMEZ; vaultic yalnızca 'deny' kullandığı için sorun yok."
  warn "GEREKLİ ADIM: Codex'i aç ve /hooks komutuyla yeni hook'lara GÜVEN ver (hash tabanlı — hook dosyaları değişirse yeniden onay gerekir)."
}

# ----------------------------------------------------------------- gitleaks

check_gitleaks() {
  info "== gitleaks =="
  if command -v gitleaks >/dev/null 2>&1; then
    info "gitleaks kurulu"
  else
    warn "gitleaks kurulu değil (önerilir, otomatik kurulmaz): brew install gitleaks"
  fi
}

# ------------------------------------------------------------------ summary

print_summary() {
  info "== Kurulum tamam — kalan manuel adımlar =="
  cat <<EOF

  1. Infisical backend'i deploy et         -> bkz. deploy/README.md
  2. Machine identity oluştur              -> deploy/README.md bölüm 2
  3. vaultic login                         -> broker'ı backend'e bağla
  4. vaultic link                          -> identity'yi cihaza bağla
  5. Bir projede: vaultic init             -> proje secret eşlemesi
  6. Touch ID testi:
       $HELPER_DEST "test" && echo APPROVED
  7. Codex kullanıyorsan: Codex içinde /hooks ile yeni hook'ları onayla

EOF
  if (( DRY_RUN )); then dry "Bu bir dry-run'dı; hiçbir dosya değiştirilmedi."; fi
}

main() {
  parse_args "$@"
  if (( DRY_RUN )); then dry "DRY-RUN modu: hiçbir şey yazılmayacak"; fi
  preflight
  build_packages
  link_cli
  install_claude_hooks
  install_skill
  register_mcp
  install_touchid_helper
  install_codex_hooks
  check_gitleaks
  print_summary
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
