# Mission Control: Java 21 monolith

`MissionControl.java` is a single 1,566-line compilation unit (1,442 nonblank lines), with 85 explicit methods, 11 ordinary constructors and four compact record constructors. It is an independent second stress case for JavaScope; the previous warehouse program is not reused. `MissionControlTest.java` contains 16 real JUnit 5 tests and independent small-input algorithm oracles.

The simulator builds a directed station network, computes routes, schedules missions with a dependency DAG, reserves launch slots and fuel transactionally, handles deadlines and failures, replays a sealed event journal, parses quoted CSV telemetry, and prints a deterministic report/checksum. It also exercises mergesort/inversion counting, LIS, knapsack, sliding windows, monotonic stacks, grid DP, union-find and memoized recursion. Java 21 record patterns and guarded type patterns require no preview flags.

In JavaScope, import **both** `.java` files together as a new project. Select a method in the dropdown. The program accepts a single stdin line:

| stdin | Scenario |
| --- | --- |
| empty or `abc` | 48 missions, seed 2048, tick limit 340 |
| `0 1` | Empty mission list |
| `24 99` | Medium repeatable scenario |
| `300 42` | Maximum supported size; 80 stations |
| `60 7 1` | Forced cancellation after one tick; checks cleanup and journal replay |

Open **Результат тестов**, edit **Ввод программы**, then press **Run**. The initial sample application's stdin can remain `5` until changed; clear it to exercise the default scenario. Expected default checksum: `1040394504`; `300 42`: `2248243505`.

The default maximum is intentionally bounded to fit JavaScope's 128 MiB JVM heap and five-second per-input timeout. This is a large source/graph stress case, not an attempt to exhaust the VPS. The simulation is mutable and intended to run once per instance. It has no network calls, threads or filesystem writes.

With Node 22, JDK 21, Docker and the built runner image available:

```bash
npm --prefix backend run stress:mission -- --output /tmp/mission-results
CHROME_PATH=/path/to/chrome npm --prefix backend run stress:mission:browser -- --output /tmp/mission-browser
```

The browser command requires the frontend/backend development servers already running. To check the published site, add `--url https://javascope.193-233-246-241.sslip.io`. Both commands are manual and excluded from per-push CI. They use real JavaParser, isolated javac/JUnit and actual browser controls; output directories include JSON evidence and screenshots. Ordinary CI retains one small compact-constructor regression inside the existing editor test group.

See the [audit report](../../../docs/audits/mission-control-2026-10-25/README.md) for observed results and limits.
