# vaultic

AI credentials vault. Tasarım: docs/plans/2026-06-10-vaultic-design.md

## Komutlar
- Build: `pnpm build` — Test: `pnpm test` — Tek test: `pnpm vitest run <dosya>`
- Typecheck: `pnpm typecheck`

## Kurallar
- MCP stdio: log SADECE console.error ile (stdout JSON-RPC kanalıdır).
- Secret değeri hiçbir log/test fixture/commit'e girmez. Testlerde sahte değer kullan: `sk-test-...`
- Broker fail-closed: backend yoksa değer verilmez, anlamlı hata fırlatılır.
- registerTool şemaları raw zod shape (z.object değil).
