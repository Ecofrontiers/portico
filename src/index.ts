import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, buildBackendRegistry } from './config';
import { startCarbonScorer } from './scoring/carbon';
import { checkLocalHealth, discoverOllamaModels } from './backends/local';
import { isRemoteConfigured } from './backends/remote';
import { checkPeerHealth, discoverPeerModels } from './backends/federated';
import completionsRouter, { setBackends } from './routes/completions';
import { authMiddleware } from './middleware/auth';
import { BackendConfig } from './types';

const app = express();

app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// --- Authentication ---

app.use(authMiddleware);

// --- Health endpoint ---

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// --- Status endpoint ---

let backends: BackendConfig[] = [];

app.get('/status', (_req, res) => {
  const healthy = backends.filter(b => b.healthy);
  const local = backends.filter(b => b.tier === 'local');
  const remote = backends.filter(b => b.tier === 'remote');
  const federated = backends.filter(b => b.tier === 'federated');

  res.json({
    gateway: 'Portico',
    version: '0.1.0',
    privacy: { default: config.privacy.default, patternsEnabled: config.privacy.patterns.enabled },
    carbon: { enabled: config.carbon.enabled, zone: config.carbon.zone },
    backends: {
      total: backends.length,
      healthy: healthy.length,
      local: local.map(b => ({ name: b.name, healthy: b.healthy, models: b.models })),
      remote: remote.map(b => ({ name: b.name, healthy: b.healthy, models: b.models })),
      federated: federated.map(b => ({ name: b.name, healthy: b.healthy })),
    },
  });
});

// --- Inference routes ---

app.use('/', completionsRouter);

// --- Backend health checker ---

async function checkAllBackends(): Promise<void> {
  for (const backend of backends) {
    if (backend.tier === 'local') {
      backend.healthy = await checkLocalHealth(backend);
      // Discover models from Ollama
      if (backend.healthy && backend.type === 'ollama' && backend.url) {
        const discovered = await discoverOllamaModels(backend.url);
        if (discovered.length > 0) backend.models = discovered;
      }
    } else if (backend.tier === 'remote') {
      backend.healthy = isRemoteConfigured(backend);
    } else if (backend.tier === 'federated' && backend.url) {
      backend.healthy = await checkPeerHealth(backend.url);
      if (backend.healthy) {
        const models = await discoverPeerModels(backend.url);
        if (models.length > 0) backend.models = models;
      }
    }
    backend.lastChecked = new Date();
  }
}

// --- Start ---

const server = app.listen(config.server.port, config.server.host, async () => {
  console.log(`
╔══════════════════════════════════════════╗
║           PORTICO v0.1.0                 ║
║   Self-Hosted AI Inference Gateway       ║
║   AGPL-3.0 · Ecofrontiers               ║
╠══════════════════════════════════════════╣
║  Endpoint:  /v1/chat/completions         ║
║  Port:      ${String(config.server.port).padEnd(28)}║
║  Privacy:   ${config.privacy.default.padEnd(28)}║
║  Carbon:    ${(config.carbon.enabled ? 'enabled' : 'disabled').padEnd(28)}║
╚══════════════════════════════════════════╝
  `);

  // Build backend registry from config
  backends = buildBackendRegistry();
  setBackends(backends);

  // Check backend health
  console.log('[startup] Checking backends...');
  await checkAllBackends();

  for (const b of backends) {
    const status = b.healthy ? '✓' : '✗';
    const models = b.models.length > 0 ? ` (${b.models.join(', ')})` : '';
    console.log(`  ${status} ${b.name} [${b.tier}]${models}`);
  }

  const healthyCount = backends.filter(b => b.healthy).length;
  console.log(`[startup] ${healthyCount}/${backends.length} backends healthy\n`);

  // Start carbon-aware scorer
  startCarbonScorer();

  // Periodic health checks (every 60s)
  setInterval(checkAllBackends, 60000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[portico] Shutting down...');
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[portico] Shutting down...');
  server.close();
  process.exit(0);
});
