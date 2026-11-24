/**
 * benchContention.js – Benchmark (b): 200 concurrent holds on ONE seat, repeated 20 times (L1)
 *
 * Runs 3 times with fresh seats each run.
 * In each run:
 *   - 20 iterations (rounds).
 *   - Each iteration sends 200 concurrent requests competing for the exact same seat.
 *   - Tracks counts of 201, 409, 503, 5xx, other.
 *   - Records winners per round and latency percentiles.
 */
import { performance } from 'node:perf_hooks';
import { getMedian } from './benchSeats.js';
import { seedBenchData } from './seedBench.js';
import { env } from '../../src/config/env.js';

export async function runContentionBenchmark({ port = env.PORT || 4000 }) {
  const baseUrl = `http://localhost:${port}/api/v1`;
  const runs = [];

  for (let run = 1; run <= 3; run++) {
    console.log(`\n--- Running Benchmark (b): Contention on ONE seat (Run ${run}/3: 20 rounds of 200 concurrent holds) ---`);
    console.log(`  Reseeding fresh inventory for Contention Run ${run}...`);
    const { tokens, showIds, seatIds } = await seedBenchData();

    const runStats = {
      run,
      totalRequests: 0,
      statusCounts: {
        201: 0,
        409: 0,
        503: 0,
        '5xx': 0,
        other: 0,
      },
      winnersPerRound: [],
      latencies: [],
    };

    // 20 rounds of 200 concurrent holds on 1 seat
    for (let round = 0; round < 20; round++) {
      // Pick a fresh show for each round to ensure the seat starts AVAILABLE
      const showId = showIds[round % showIds.length];
      const seatId = seatIds[0];
      const url = `${baseUrl}/shows/${showId}/holds`;

      let roundWinners = 0;

      // Fire 200 concurrent requests using the 200 benchmark user tokens
      const promises = tokens.slice(0, 200).map(async ({ token }) => {
        const start = performance.now();
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ seatIds: [seatId] }),
          });
          const latency = performance.now() - start;
          const status = res.status;

          return { status, latency };
        } catch (err) {
          const latency = performance.now() - start;
          return { status: 599, latency, error: err.message };
        }
      });

      const results = await Promise.all(promises);

      for (const r of results) {
        runStats.totalRequests++;
        runStats.latencies.push(r.latency);

        if (r.status === 201) {
          runStats.statusCounts[201]++;
          roundWinners++;
        } else if (r.status === 409) {
          runStats.statusCounts[409]++;
        } else if (r.status === 503) {
          runStats.statusCounts[503]++;
        } else if (r.status >= 500) {
          runStats.statusCounts['5xx']++;
        } else {
          runStats.statusCounts.other++;
        }
      }

      runStats.winnersPerRound.push(roundWinners);
      process.stdout.write(`  Round ${round + 1}/20: Winner=${roundWinners} | `);
      if ((round + 1) % 4 === 0) process.stdout.write('\n');
    }

    // Sort latencies to compute percentiles
    const sortedLat = [...runStats.latencies].sort((a, b) => a - b);
    const sumLat = sortedLat.reduce((acc, v) => acc + v, 0);

    const p = (pct) => {
      const idx = Math.min(Math.floor((pct / 100) * sortedLat.length), sortedLat.length - 1);
      return sortedLat[idx];
    };

    runStats.latencySummary = {
      min: sortedLat[0],
      avg: sumLat / sortedLat.length,
      p50: p(50),
      p975: p(97.5),
      p99: p(99),
      max: sortedLat[sortedLat.length - 1],
    };

    console.log(`\n  Run ${run} Summary: 201=${runStats.statusCounts[201]}, 409=${runStats.statusCounts[409]}, 503=${runStats.statusCounts[503]}, 5xx=${runStats.statusCounts['5xx']}`);
    console.log(`  Latency: avg=${runStats.latencySummary.avg.toFixed(2)}ms, p50=${runStats.latencySummary.p50.toFixed(2)}ms, p99=${runStats.latencySummary.p99.toFixed(2)}ms, max=${runStats.latencySummary.max.toFixed(2)}ms`);

    runs.push(runStats);
  }

  // Calculate min, median, max across the 3 runs
  const count201 = runs.map((r) => r.statusCounts[201]);
  const count409 = runs.map((r) => r.statusCounts[409]);
  const count503 = runs.map((r) => r.statusCounts[503]);
  const count5xx = runs.map((r) => r.statusCounts['5xx']);
  const latAvg = runs.map((r) => r.latencySummary.avg);
  const latP50 = runs.map((r) => r.latencySummary.p50);
  const latP975 = runs.map((r) => r.latencySummary.p975);
  const latP99 = runs.map((r) => r.latencySummary.p99);

  return {
    runs,
    aggregated: {
      status201: { min: Math.min(...count201), median: getMedian(count201), max: Math.max(...count201) },
      status409: { min: Math.min(...count409), median: getMedian(count409), max: Math.max(...count409) },
      status503: { min: Math.min(...count503), median: getMedian(count503), max: Math.max(...count503) },
      status5xx: { min: Math.min(...count5xx), median: getMedian(count5xx), max: Math.max(...count5xx) },
      latencyAvg: { min: Math.min(...latAvg), median: getMedian(latAvg), max: Math.max(...latAvg) },
      latencyP50: { min: Math.min(...latP50), median: getMedian(latP50), max: Math.max(...latP50) },
      latencyP975: { min: Math.min(...latP975), median: getMedian(latP975), max: Math.max(...latP975) },
      latencyP99: { min: Math.min(...latP99), median: getMedian(latP99), max: Math.max(...latP99) },
    },
  };
}
