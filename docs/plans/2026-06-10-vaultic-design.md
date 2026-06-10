# vaultic — AI Credentials Vault Tasarım Dokümanı

**Tarih:** 2026-06-10
**Durum:** Onaylandı (beyin fırtınası + 5 ajanlık pazar araştırması sonrası)
**Stack:** TypeScript (broker MCP + CLI), Go binary olarak agent-vault (upstream), Infisical CE (backend)

## 1. Problem

AI kodlama ajanları (Claude Code, Codex, Cursor) projelerde sürekli API key/secret'a ihtiyaç duyuyor. Bugünkü pratik: değerler memory'den/`.env`'den kopyalanıyor, yönetilemiyor ve sızıyor. Kanıt (GitGuardian State of Secrets Sprawl 2026): public GitHub'da 29M yeni hardcoded secret (+%34), MCP config dosyalarında 24.008 secret (2.117'si canlı), AI eş-yazarlı commit'lerde 2x sızıntı oranı. Claude Code'un `.env` dosyasını `permissions.deny` kuralına rağmen okuyup context'e taşıyabildiği sahada doğrulandı (Martin Paul Eve, Knostic — Nisan 2026).

## 2. Çözüm özeti

Self-host edilebilir, workspace tabanlı, **AI'nın secret değerini varsayılan olarak hiç görmediği** bir kasa sistemi:

- AI ajan sadece **referans** kullanır: `vault://workspace/proje/env/KEY`
- Gerçek değer çalıştırma anında env'e inject edilir (`vault_run`) veya paranoid modda giden HTTPS isteğine proxy'de enjekte edilir (agent-vault)
- İstisnai durumda değer, kullanıcının açık onayıyla (Touch ID / Telegram) tek seferlik verilir + audit log
- Default private; paylaşım kullanıcının açık kararıyla kişi/grup bazında
- Herkes kendi kurabilir: lokal docker-compose veya kendi sunucusu

## 3. Araştırma bulguları (Haziran 2026)

### Temel seçimi
- **Bitwarden Secrets Manager — elendi.** Erişim modeli (proje-scoped machine account, default-private) ideal ama: self-host yalnızca Enterprise lisans dosyasıyla; Vaultwarden SM'i desteklemiyor ve desteklemeyecek; SDK lisansı türev çalışmayı ve üçüncü taraf dağıtımını yasaklıyor.
- **Infisical CE — seçildi.** MIT çekirdek; self-host CE'de kullanıcı/proje/identity limiti yok; docker-compose ile 3 konteyner (min 2 CPU/4GB); org→proje→environment hiyerarşisi default-private; machine identity 8 auth yöntemi; `infisical run` ile env injection. Eksikler: approval workflows Enterprise'a kilitli (broker'da biz yazıyoruz), resmi MCP server'ı değeri AI'ya döndürüyor (kullanmıyoruz), granüler custom RBAC Pro'da (built-in 4 rol v1 için yeterli).
- **OpenBao** sağlam ama tek kullanıcı/küçük takım için operasyonel yükü ağır; ileride pluggable backend adayı.

### Prior art ve boşluk
Self-host + workspace default-private paylaşım + MCP-native referans modeli + onaylı istisnai erişim kombinasyonu hiçbir üründe bir arada yok. En yakınlar: 1Password Environments (cloud-only, kapalı, Codex'e özel), Infisical Agent Vault (MIT, 1.6k yıldız — proxy katmanı olarak entegre ediyoruz), open-vault (vizyon yakın, v0.0.1), mcp-secrets-vault (`use_secret` action-proxy pattern'i), Cloak (sahte değer diskte + onaylı inject pattern'i).

## 4. Mimari

```
AI host'lar (Claude Code / Codex / MCP host)     aiv CLI yerine: vaultic CLI (insan)
        │ referans/inject/onay isteği                     │ kurulum·paylaşım·onay
        ▼                                                 ▼
vaultic-broker (MCP server, TS) — secret değerini ASLA döndürmez
        │                    │                      │
   vault_run            agent-vault proxy       onay akışı
   (env inject)         (placeholder + MITM)    (Touch ID / Telegram)
        │                    │
        ▼                    ▼ gerçek key giden istekte
Infisical CE (self-host)   Hedef API'ler (OpenAI, AWS…)
```

### Bileşenler
1. **Infisical CE** (docker-compose: backend + Postgres + Redis): kasa, workspace/proje/environment, kullanıcı yönetimi, machine identity, audit log.
2. **vaultic-broker** (TS, MCP server): tek değer-görmez kapı. Infisical'a proje-scoped machine identity (Universal Auth) ile bağlanır.
3. **agent-vault proxy** (Go, upstream binary): paranoid mod. `.env`'de placeholder, gerçek değer giden HTTPS isteğinde enjekte + egress filtering.
4. **vaultic CLI** (TS): insan tarafı — `vaultic init/login/set/share/check/run/approve`.
5. **Claude Code skill**: "API key gerektiğinde önce `vault_check`; koda/config'e sadece referans yaz; değer isteme" disiplini.
6. **Hook'lar**: SessionStart (manifest durumu bildirimi), PreToolUse (fingerprint + regex secret-leak engeli).

### MCP tool seti
| Tool | İş | Değer döner mi? |
|---|---|---|
| `vault_check` | Manifest'e göre eksik/mevcut raporu | Hayır |
| `vault_list` | Erişilebilir isimler + metadata | Hayır |
| `vault_ref` | `vault://` referansı üretir | Hayır |
| `vault_run` | Komutu inject'li env ile çalıştırır, çıktıyı redakte eder | Hayır (redakte) |
| `vault_reveal_request` | Onay akışı → tek seferlik değer + audit | Sadece onayla |
| `vault_set_request` | AI isim/metadata önerir, değeri kullanıcı güvenli prompt'a girer | Hayır |

### Manifest: `.aiv.yaml` (git'e girer, değer içermez)
```yaml
workspace: blackhole-labs
project: payment-api
mode: standard   # standard | paranoid
needs:
  OPENAI_API_KEY: vault://blackhole-labs/payment-api/prod/OPENAI_API_KEY
  STRIPE_SECRET:  vault://blackhole-labs/payment-api/prod/STRIPE_SECRET
```

## 5. Güvenlik katmanları → tehdit eşlemesi

| Katman | Kestiği saldırı |
|---|---|
| Referans modeli (broker değer döndürmez) | Transcript/context/telemetri sızıntısı |
| Proxy + egress filtering (paranoid mod) | Prompt injection ile env okuma / key'i yabancı domaine gönderme |
| PreToolUse fingerprint kontrolü (salted hash + regex) | Değerin dosyaya/koda/komuta yazılması |
| gitleaks pre-commit | Git'e sızma (son hat) |
| Onay (Touch ID lokal / Telegram uzak) + audit | İstisnai erişimin kontrolsüz kullanımı, confused deputy |
| Proje-scoped machine identity | Blast radius sınırı |
| Fail-closed broker | Kasa erişilemezken sessiz fallback/sızıntı |

Fingerprint detayı: vault'taki her değerin salted hash'i (+ kayan pencere parçaları, base64 varyantları) lokalde tutulur; Write/Edit/Bash içeriği eşleşirse tool çağrısı bloklanır. Not: tehdit modeli bölümü implementasyon planında derinleştirilecek (araştırmanın saldırı-yüzeyi ayağı zayıf döndü, tekrarlanacak).

## 6. Paylaşım modeli

- Infisical default-private projeler olduğu gibi kullanılır; üye yalnızca eklendiği projeyi görür.
- `vaultic share <KEY|proje> --with <kişi/grup> [--role viewer|member]` → Infisical proje üyeliği.
- Reveal onayı broker'da: istek → kullanıcıya Touch ID (macOS lokal) veya Telegram bot mesajı (uzak/sunucu) → onay → tek seferlik değer + audit kaydı; timeout'ta red.

## 7. Dağıtım

Tek repo (`vaultic`), üç kurulum hedefi:
1. `docker-compose up` — Infisical CE + broker (lokal veya kendi sunucusu)
2. `install.sh` — CLI + skill + hook'lar (Claude Code `~/.claude/`, Codex `~/.codex/`; persistent-memory'de kanıtlanmış dağıtım pattern'i)
3. MCP config snippet'i — diğer MCP host'lar için

## 8. Hata yönetimi

- Broker fail-closed: kasa erişilemezse değer asla diskten/cache'ten verilmez; AI'ya eylenebilir hata döner ("`vaultic login` çalıştır").
- Tüm exception'lar anlamlı mesajla; boş catch yasak (CLAUDE.md kuralı).
- Onay timeout (varsayılan 120 sn) → otomatik red + audit.

## 9. Test stratejisi (TDD)

Kritik senaryolar: fingerprint bypass denemeleri (base64/parçalı/URL-encoded yazım), `vault_run` çıktı redaksiyon doğruluğu, onay timeout ve eşzamanlı istekler, Infisical bağlantı kopması (fail-closed doğrulama), manifest parse hataları, paranoid modda egress ihlali.

## 10. Açık konular (plan aşamasına devredilen)

- Saldırı yüzeyi araştırmasının derinleştirilmesi (tehdit modeli dokümanı)
- Telegram onay botunun kimlik doğrulama detayı
- Fingerprint store'un kendisinin korunması (salted hash dosyasının yeri/izinleri)
- agent-vault'un HTTPS_PROXY'ye uymayan araçlarla davranışı (dokümante edilecek sınır)
