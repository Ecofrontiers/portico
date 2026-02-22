# Portico

**Self-hosted AI inference gateway.** Your data, your rules, your models.

Portico sits between your applications and AI backends. It exposes a single OpenAI-compatible API, routes queries to local models or remote providers based on privacy rules you define, and optionally factors grid carbon intensity into routing decisions.

```
Your Applications
        │
   POST /v1/chat/completions
        │
┌───────▼──────────────────────┐
│       PORTICO GATEWAY        │
│                              │
│  ┌────────────────────────┐  │
│  │    Privacy Router      │  │
│  │  headers · patterns ·  │  │
│  │     default policy     │  │
│  └───────────┬────────────┘  │
│  ┌───────────▼────────────┐  │
│  │  Carbon-Aware Scorer   │  │
│  │  quality · latency ·   │  │
│  │    carbon intensity    │  │
│  └───────────┬────────────┘  │
│  ┌───────────▼────────────┐  │
│  │     Route Engine       │  │
│  └──┬────────┼────────┬───┘  │
└─────┼────────┼────────┼──────┘
      │        │        │
      ▼        ▼        ▼
   LOCAL    REMOTE   FEDERATED
   MODELS  PROVIDERS  PEERS
```

## Quick Start

```bash
# With Docker (recommended)
git clone https://github.com/Ecofrontiers/portico.git
cd portico
docker compose up -d

# Without Docker
npm install
cp .env.example .env
npm run dev
```

Once running, point any OpenAI-compatible client at `http://localhost:3040`:

```bash
curl http://localhost:3040/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## What It Does

**Privacy routing.** Every query is classified before touching any backend:
- `local-only` — never leaves your network (PII detected, or explicit header)
- `local-preferred` — tries local first, falls back to remote
- `remote-ok` — any backend eligible

Classification happens via three methods:
1. **Header annotation** — `X-Portico-Privacy: local-only`
2. **Pattern matching** — built-in PII detection (emails, phone numbers, credit cards, IBANs)
3. **Default policy** — configurable in `portico.yml`

**Multi-backend routing.** Connect local and remote backends:
- **Local:** Ollama, vLLM, llama.cpp (your hardware, your data)
- **Remote:** OpenAI, Anthropic, Mistral (when local can't serve)
- **Federated:** other Portico instances (cooperative capacity sharing)

**Carbon-aware selection** (optional). When multiple backends are available, prefer the one running on cleaner energy. Uses [Electricity Maps](https://www.electricitymaps.com/) for real-time grid carbon intensity.

**Provider-agnostic.** Applications talk OpenAI-compatible API. Swap backends in the config file — no application code changes.

## Configuration

All settings live in `portico.yml`:

```yaml
privacy:
  default: local-preferred
  patterns:
    enabled: true

backends:
  local:
    - name: ollama
      type: ollama
      url: http://localhost:11434

  remote:
    - name: openai
      type: openai
      models: [gpt-4o, gpt-4o-mini]

carbon:
  enabled: false
  zone: DE
```

API keys for remote providers go in `.env`:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

See [`portico.yml`](portico.yml) for the full configuration reference.

## Privacy Enforcement

When a query is classified `local-only`, Portico **never** routes it to a remote backend — it returns a 503 error instead. This is a hard guarantee, not a preference.

```
# This query contains an email → auto-classified local-only
curl -X POST http://localhost:3040/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Summarize this for john@example.com"}]}'

# → Routed to local Ollama (email detected, local-only enforced)
```

You can also annotate requests explicitly:

```bash
curl -X POST http://localhost:3040/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Portico-Privacy: local-only" \
  -d '{"messages": [{"role": "user", "content": "Classify this patient record"}]}'
```

## Response Metadata

Every response includes Portico routing metadata:

```json
{
  "id": "chatcmpl-...",
  "choices": [...],
  "portico": {
    "backend": "ollama",
    "tier": "local",
    "privacyClass": "local-only",
    "routingReason": "ollama (local) · privacy: local-only via pattern · score: 2 · 1 candidates"
  }
}
```

Response headers:
- `X-Portico-Backend` — which backend served the request
- `X-Portico-Tier` — local, remote, or federated
- `X-Portico-Privacy` — the privacy classification applied

## Architecture

Portico has three processing stages:

1. **Privacy Router** — classifies every query before it touches any backend. Three methods: header annotation, regex pattern matching, configurable default policy.

2. **Carbon-Aware Scorer** — when enabled, scores eligible backends by quality match, expected latency, and grid carbon intensity.

3. **Route Engine** — combines privacy classification with backend scores. Binary enforcement: `local-only` queries never reach remote backends.

## Roadmap

**Groundwork (complete):**
- OpenAI-compatible gateway with multi-backend routing
- Local model integration (Ollama, vLLM, llama.cpp)
- Privacy routing engine (PII detection, header annotation, default policy)
- Carbon-aware scoring (Electricity Maps, single-zone)

**Next milestones:**

| # | Milestone | Description |
|---|-----------|-------------|
| 1 | Streaming + auth | SSE streaming, API key management, per-key rate limits |
| 2 | Multi-zone carbon scoring | Per-backend grid zone assignment, cross-region comparison |
| 3 | Federation protocol | Peer discovery, capacity advertisement, cross-instance routing with privacy policy preservation |
| 4 | Packaging | Helm chart, systemd service, one-click Docker Compose |
| 5 | Security hardening | Threat model, prompt injection resistance, integration tests |

## Development

```bash
npm install
npm run dev      # Start with hot reload
npm test         # Run tests
npm run build    # TypeScript → dist/
```

## Comparison

| | Portico | LiteLLM | Ollama | LocalAI | OpenRouter |
|---|---|---|---|---|---|
| Self-hosted | Yes | Yes | Yes | Yes | No |
| Local models | Yes | Limited | Yes | Yes | No |
| Remote providers | Yes | Yes | No | Limited | Yes |
| Privacy routing | Yes | No | No | No | No |
| Carbon-aware | Yes | No | No | No | No |
| Federation | Planned | No | No | No | No |
| License | AGPL-3.0 | MIT | MIT | MIT | Proprietary |

## Who This Is For

- **Schools and universities** — provide AI access without sending student data to corporate APIs
- **European public institutions** — AI with data residency controls (GDPR)
- **Self-hosters** — proper gateway for your Ollama setup with remote fallback
- **SMEs** — run cheap local models for 80% of queries, pay-as-you-go remote for the rest

## License

[AGPL-3.0-or-later](LICENSE) — Ecofrontiers SARL
