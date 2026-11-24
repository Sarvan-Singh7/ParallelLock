/**
 * benchThroughput.js – Benchmark (c): 200 concurrent users holding different seats (L1)
 *
 * Runs 3 iterations (reseeding between iterations).
 * In each run:
 *   - 200 concurrent requests from 200 distinct users.
 *   - Each user attempts to hold a unique seat on the same show.
 *   - Reports status counts (201, 409, 503, 5xx), total time, req/sec, and latency percentiles.
 */
import { performance } from 'node:perf_hooks';
import { getMedian } from './benchSeats.js';
import { seedBenchData } from './seedBench.js';
import { env } from '../../src/config/env.js';

export async function runThroughputBenchmark({ port = env.PORT || 4000 }) {
  const baseUrl = `http://localhost:${port}/api/v1`;
  const runs = [];

  for (let run = 1; run <= 3; run++) {
    console.log(`\n--- Running Benchmark (c): 200 users holding DIFFERENT seats (Run ${run}/3) ---`);

    // Reseed fresh data before each run
    console.log(`  Reseeding fresh inventory for Run ${run}...`);
    const { tokens, showIds, seatIds } = await seedBenchData();
    const showId = showIds[0];
    const url = `${baseUrl}/shows/${showId}/holds`;

    const runStats = {
      run,
      totalRequests: 200,
      statusCounts: {
        201: 0,
        409: 0,
        503: 0,
        '5xx': 0,
        other: 0,
      },
      latencies: [],
    };

    const overallStart = performance.now();

    // 200 users holding 200 different seats simultaneously
    const promises = tokens.slice(0, 200).map(async ({ token }, idx) => {
      const seatId = seatIds[idx];
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
        return { status: res.status, latency };
      } catch (err) {
        const latency = performance.now() - start;
        return { status: 599, latency, error: err.message };
      }
    });

    const results = await Promise.all(promises);
    const overallDurationSec = (performance.now() - overallStart) / 1000;

    for (const r of results) {
      runStats.latencies.push(r.latency);

      if (r.status === 201) {
        runStats.statusCounts[201]++;
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

    const sortedLat = [...runStats.latencies].sort((a, b) => a - b);
    const sumLat = sortedLat.reduce((acc, v) => acc + v, 0);

    const p = (pct) => {
      const idx = Math.min(Math.floor((pct / 100) * sortedLat.length), sortedLat.length - 1);
      return sortedLat[idx];
    };

    runStats.durationSec = overallDurationSec;
    runStats.reqSec = 200 / overallDurationSec;
    runStats.latencySummary = {
      min: sortedLat[0],
      avg: sumLat / sortedLat.length,
      p50: p(50),
      p975: p(97.5),
      p99: p(99),
      max: sortedLat[sortedLat.length - 1],
    };

    console.log(`  Run ${run} Result: 201=${runStats.statusCounts[201]}, 409=${runStats.statusCounts[409]}, 503=${runStats.statusCounts[503]}, 5xx=${runStats.statusCounts['5xx']}`);
    console.log(`  Throughput: ${runStats.reqSec.toFixed(2)} req/sec (${overallDurationSec.toFixed(3)}s total)`);
    console.log(`  Latency: avg=${runStats.latencySummary.avg.toFixed(2)}ms, p50=${runStats.latencySummary.p50.toFixed(2)}ms, p99=${runStats.latencySummary.p99.toFixed(2)}ms, max=${runStats.latencySummary.max.toFixed(2)}ms`);

    runs.push(runStats);
  }

  const count201 = runs.map((r) => r.statusCounts[201]);
  const reqSecs = runs.map((r) => r.reqSec);
  const latAvg = runs.map((r) => r.latencySummary.avg);
  const latP50 = runs.map((r) => r.latencySummary.p50);
  const latP975 = runs.map((r) => r.latencySummary.p975);
  const latP99 = runs.map((r) => r.latencySummary.p99);

  return {
    runs,
    aggregated: {
      status201: { min: Math.min(...count201), median: getMedian(count201), max: Math.max(...count201) },
      reqSec: { min: Math.min(...reqSecs), median: getMedian(reqSecs), max: Math.max(...reqSecs) },
      latencyAvg: { min: Math.min(...latAvg), median: getMedian(latAvg), max: Math.max(...latAvg) },
      latencyP50: { min: Math.min(...latP50), median: getMedian(latP50), max: Math.max(...latP50) },
      latencyP975: { min: Math.min(...latP975), median: getMedian(latP975), max: Math.max(...latP975) },
      latencyP99: { min: Math.min(...latP99), median: getMedian(latP99), max: Math.max(...latP99) },
    },
  };
}
