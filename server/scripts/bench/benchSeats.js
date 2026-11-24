/**
 * benchSeats.js – Benchmark (a): GET /shows/:id/seats for 30s at 50 & 200 connections (L1)
 *
 * Runs 3 iterations at 50 connections and 3 iterations at 200 connections.
 * Reports real min, median, and max for requests/sec and latency percentiles.
 */
import autocannon from 'autocannon';
import { env } from '../../src/config/env.js';

export function getMedian(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function runAutocannonOnce({ url, connections, durationSeconds = 30 }) {
  return new Promise((resolve, reject) => {
    autocannon(
      {
        url,
        connections,
        duration: durationSeconds,
        pipelining: 1,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
  });
}

export async function runSeatsBenchmark({ showId = 1, port = env.PORT || 4000, durationSeconds = 30 }) {
  const url = `http://localhost:${port}/api/v1/shows/${showId}/seats`;
  const conns = [50, 200];
  const summary = {};

  for (const c of conns) {
    console.log(`\n--- Running Benchmark (a): GET /shows/${showId}/seats @ ${c} connections (3 runs x ${durationSeconds}s) ---`);
    const runs = [];

    for (let run = 1; run <= 3; run++) {
      console.log(`  Run ${run}/3 (${c} conns, ${durationSeconds}s)...`);
      const res = await runAutocannonOnce({ url, connections: c, durationSeconds });
      runs.push({
        run,
        reqSecAvg: res.requests.average,
        reqSecMin: res.requests.min,
        reqSecMax: res.requests.max,
        totalRequests: res.requests.total,
        latencyAvg: res.latency.average,
        latencyP50: res.latency.p50,
        latencyP975: res.latency.p97_5,
        latencyP99: res.latency.p99,
        latencyMax: res.latency.max,
        errors: res.errors,
        timeouts: res.timeouts,
        non2xx: res.non2xx,
      });
      console.log(`    Result: ${res.requests.average} req/sec, avg latency ${res.latency.average} ms, p99 ${res.latency.p99} ms`);
    }

    const reqAverages = runs.map((r) => r.reqSecAvg);
    const latAverages = runs.map((r) => r.latencyAvg);
    const p50s = runs.map((r) => r.latencyP50);
    const p975s = runs.map((r) => r.latencyP975);
    const p99s = runs.map((r) => r.latencyP99);

    summary[`concurrency_${c}`] = {
      connections: c,
      runs,
      stats: {
        reqSec: {
          min: Math.min(...reqAverages),
          median: getMedian(reqAverages),
          max: Math.max(...reqAverages),
        },
        latencyAvg: {
          min: Math.min(...latAverages),
          median: getMedian(latAverages),
          max: Math.max(...latAverages),
        },
        p50: {
          min: Math.min(...p50s),
          median: getMedian(p50s),
          max: Math.max(...p50s),
        },
        p975: {
          min: Math.min(...p975s),
          median: getMedian(p975s),
          max: Math.max(...p975s),
        },
        p99: {
          min: Math.min(...p99s),
          median: getMedian(p99s),
          max: Math.max(...p99s),
        },
      },
    };
  }

  return summary;
}
