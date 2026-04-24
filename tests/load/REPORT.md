# Load test report

5 endpoints × 3 VU targets (10 / 100 / 500). Each cell = steady-state metrics during the 30s hold phase.

Command: `cd tests/load && ./run.sh`

Generated: 2026-04-24T04:06:38.253Z

## POST /auth/login

| VUs | p50 | p90 | p95 | p99 | max | err rate | throughput | total |
|----:|----:|----:|----:|----:|----:|---------:|-----------:|------:|
| 10 | 81ms | 85ms | 87ms | 92ms | 101ms | 0.00% | 14.5/s | 658 |
| 100 | 619ms | 647ms | 676ms | 937ms | 4534ms | 0.00% | 80.4/s | 3653 |
| 500 | 5055ms | 5085ms | 5116ms | 5130ms | 39766ms | 0.00% | 86.9/s | 4179 |

## GET /auth/me

| VUs | p50 | p90 | p95 | p99 | max | err rate | throughput | total |
|----:|----:|----:|----:|----:|----:|---------:|-----------:|------:|
| 10 | 11ms | 13ms | 14ms | 19ms | 77ms | 0.00% | 135.9/s | 6156 |
| 100 | 3ms | 6ms | 7ms | 13ms | 80ms | 0.00% | 1529.7/s | 69329 |
| 500 | 134ms | 155ms | 169ms | 188ms | 205ms | 0.00% | 2464.9/s | 111738 |

## GET /crm/leads

| VUs | p50 | p90 | p95 | p99 | max | err rate | throughput | total |
|----:|----:|----:|----:|----:|----:|---------:|-----------:|------:|
| 10 | 34ms | 40ms | 42ms | 48ms | 91ms | 0.00% | 35.8/s | 1628 |
| 100 | 34ms | 56ms | 71ms | 113ms | 161ms | 0.00% | 351.2/s | 15894 |
| 500 | 1108ms | 1294ms | 1344ms | 1419ms | 1664ms | 0.00% | 353.1/s | 16022 |

## POST /crm/leads

| VUs | p50 | p90 | p95 | p99 | max | err rate | throughput | total |
|----:|----:|----:|----:|----:|----:|---------:|-----------:|------:|
| 10 | 45ms | 51ms | 52ms | 58ms | 130ms | 0.00% | 15.5/s | 703 |
| 100 | 26ms | 53ms | 61ms | 92ms | 139ms | 0.00% | 156.1/s | 7111 |
| 500 | 1617ms | 1882ms | 1950ms | 2083ms | 2117ms | 0.00% | 225.2/s | 10273 |

## GET /crm/deals

| VUs | p50 | p90 | p95 | p99 | max | err rate | throughput | total |
|----:|----:|----:|----:|----:|----:|---------:|-----------:|------:|
| 10 | 13ms | 21ms | 22ms | 27ms | 77ms | 0.00% | 38.9/s | 1767 |
| 100 | 6ms | 11ms | 15ms | 24ms | 74ms | 0.00% | 398.2/s | 18108 |
| 500 | 507ms | 608ms | 664ms | 796ms | 837ms | 0.00% | 636.7/s | 28978 |

## Where things break

Threshold: p95 ≤ 1500ms AND error rate < 5%. First VU target where either fails = the limit.

| Endpoint | First broken @ | Why |
|---|---|---|
| POST /auth/login | 500 | p95=5116ms |
| GET /auth/me | held 500 VUs | — |
| GET /crm/leads | held 500 VUs | — |
| POST /crm/leads | 500 | p95=1950ms |
| GET /crm/deals | held 500 VUs | — |
