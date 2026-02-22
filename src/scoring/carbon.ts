/**
 * Carbon-Aware Scorer
 *
 * Multi-objective scoring for backend selection.
 * When enabled, queries Electricity Maps for real-time grid carbon intensity
 * and factors this into routing decisions.
 *
 * Three scoring dimensions:
 * - Quality match (does the backend have the requested model?)
 * - Expected latency (local < remote)
 * - Grid carbon intensity (lower is better)
 *
 * Ecofrontiers SARL, AGPL-3.0
 */

import { EnergyData, BackendConfig } from '../types';
import { config } from '../config';

let currentEnergy: EnergyData | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Fetch carbon intensity from Electricity Maps API.
 */
async function fetchCarbonIntensity(zone: string, apiKey: string): Promise<EnergyData | null> {
  try {
    const res = await fetch(
      `https://api.electricitymap.org/v3/carbon-intensity/latest?zone=${zone}`,
      { headers: { 'auth-token': apiKey }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) {
      console.error(`[carbon] Electricity Maps returned ${res.status} for zone ${zone}`);
      return null;
    }
    const data = await res.json() as any;

    return {
      zone,
      carbonIntensity: data.carbonIntensity ?? 0,
      renewablePercent: 0, // requires power-breakdown endpoint
      pricePerKwh: 0,
      source: 'electricity-maps',
      lastUpdated: new Date(),
    };
  } catch (err) {
    console.error(`[carbon] Failed to fetch Electricity Maps:`, err);
    return null;
  }
}

/**
 * Poll carbon data on interval.
 */
async function poll(): Promise<void> {
  const apiKey = process.env.ELECTRICITY_MAPS_API_KEY;
  const zone = config.carbon.zone;
  if (!apiKey || !zone) return;

  const data = await fetchCarbonIntensity(zone, apiKey);
  if (data) {
    currentEnergy = data;
    console.log(
      `[carbon] ${zone}: ${data.carbonIntensity}g CO2/kWh (${data.source})`
    );
  }
}

/**
 * Start the carbon-aware scorer polling loop.
 */
export function startCarbonScorer(): void {
  if (!config.carbon.enabled) {
    console.log('[carbon] Disabled (set carbon.enabled: true in portico.yml)');
    return;
  }

  const interval = (config.carbon.poll_interval ?? 300) * 1000;
  console.log(`[carbon] Starting (zone: ${config.carbon.zone}, interval: ${interval / 1000}s)`);
  poll();
  pollTimer = setInterval(poll, interval);
}

export function stopCarbonScorer(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Get the current carbon intensity. Returns null if carbon scoring is disabled.
 */
export function getCarbonIntensity(): number | null {
  if (!config.carbon.enabled || !currentEnergy) return null;
  return currentEnergy.carbonIntensity;
}

/**
 * Score a backend based on carbon awareness and latency.
 * Lower score = better.
 */
export function scoreBackend(backend: BackendConfig): number {
  let score = 0;

  // Latency bias: local is fast, remote adds latency
  if (backend.tier === 'local') score += 0;
  else if (backend.tier === 'federated') score += 20;
  else score += 40; // remote

  // Priority from config
  score += (backend.priority ?? 5) * 2;

  // Carbon factor (when data is available)
  const carbonIntensity = getCarbonIntensity();
  if (carbonIntensity !== null && backend.tier === 'remote') {
    // Penalize remote backends when local grid is clean
    // (running locally on clean power is better than sending to a remote datacenter)
    if (carbonIntensity < 100) {
      score += 30; // local grid is very clean, prefer local
    } else if (carbonIntensity < 300) {
      score += 10; // moderate — slight preference for local
    }
    // If local grid is dirty (>300g), remote might be cleaner — reduce penalty
  }

  return score;
}
