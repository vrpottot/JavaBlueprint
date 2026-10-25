import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SplittableRandom;
import static org.junit.jupiter.api.Assertions.*;

class MissionControlTest {
    static MissionControl.Mission mission(int id, int duration, List<Integer> dependencies) {
        return new MissionControl.Mission(id, MissionControl.MissionKind.SURVEY,
                1, 2, duration, 100, 5, dependencies);
    }

    @Test
    void inputDefaultsClampingAndInvalidNumbers() {
        assertEquals(MissionControl.Config.defaults(), MissionControl.Config.parse(null));
        assertEquals(MissionControl.Config.defaults(), MissionControl.Config.parse("abc"));
        assertEquals(MissionControl.Config.defaults(), MissionControl.Config.parse("2 nope"));
        assertEquals(new MissionControl.Config(0, 3, 52), MissionControl.Config.parse("-4 3"));
        assertEquals(new MissionControl.Config(300, 7, 2000), MissionControl.Config.parse("999 7 9999"));
        assertEquals(new MissionControl.Config(2, 2048, 1), MissionControl.Config.parse("2 2048 -1"));
        assertThrows(IllegalArgumentException.class, () -> new MissionControl.Config(301, 1, 10));
    }

    @Test
    void shortestPathsAgreeWithIndependentBellmanFordOnRandomNetworks() {
        SplittableRandom random = new SplittableRandom(4411);
        for (int graph = 0; graph < 12; graph++) {
            MissionControl.Network network = new MissionControl.Network(9);
            for (int edge = 0; edge < 28; edge++) {
                network.connect(random.nextInt(9), random.nextInt(9), 1 + random.nextInt(30), random.nextInt(10));
            }
            network.close(0, 1);
            for (int risk : new int[]{2, 9}) {
                long[][] floyd = network.allPairs(risk);
                for (int from = 0; from < network.size(); from++) {
                    long[] oracle = new long[9];
                    Arrays.fill(oracle, MissionControl.INF);
                    oracle[from] = 0;
                    for (int pass = 0; pass < 8; pass++) {
                        for (List<MissionControl.Edge> edges : network.outgoing) {
                            for (MissionControl.Edge edge : edges) {
                                // Deliberately do not call Network.usable or shortest in the oracle.
                                if (edge.risk() > risk || edge.from() == 0 && edge.to() == 1) {
                                    continue;
                                }
                                if (oracle[edge.from()] != MissionControl.INF) {
                                    oracle[edge.to()] = Math.min(oracle[edge.to()], oracle[edge.from()] + edge.latency());
                                }
                            }
                        }
                    }
                    for (int to = 0; to < network.size(); to++) {
                        var route = network.shortest(from, to, risk);
                        assertEquals(oracle[to], route.map(MissionControl.Route::latency).orElse(MissionControl.INF));
                        assertEquals(oracle[to], floyd[from][to]);
                        if (route.isPresent()) {
                            List<Integer> path = route.orElseThrow().stations();
                            assertEquals(from, path.get(0));
                            assertEquals(to, path.get(path.size() - 1));
                            assertEquals(path.size(), new HashSet<>(path).size());
                        }
                    }
                }
            }
        }
    }

    @Test
    void closuresRiskFiltersAndUnreachableStationsAffectBothTraversals() {
        MissionControl.Network network = new MissionControl.Network(4);
        network.connect(0, 1, 2, 1);
        network.connect(1, 2, 3, 1);
        network.connect(0, 2, 1, 8);
        assertEquals(5, network.shortest(0, 2, 2).orElseThrow().latency());
        assertEquals(1, network.shortest(0, 2, 9).orElseThrow().latency());
        assertTrue(network.shortest(0, 3, 9).isEmpty());
        assertEquals(Set.of(0, 1, 2), new HashSet<>(network.breadthFirst(0, 2)));
        assertEquals(Set.of(0, 1, 2), new HashSet<>(network.depthFirst(0, 2)));
        network.close(1, 2);
        assertTrue(network.shortest(0, 2, 2).isEmpty());
        assertEquals(List.of(0, 1), network.breadthFirst(0, 2));
        network.reopen(1, 2);
        assertEquals(5, network.shortest(0, 2, 2).orElseThrow().latency());
        assertThrows(IllegalArgumentException.class, () -> network.connect(4, 0, 1, 1));
    }

    @Test
    void dependencyDiamondCriticalPathAndCycleDetection() {
        MissionControl.Repository<MissionControl.Mission> missions = new MissionControl.Repository<>();
        missions.add(mission(0, 2, List.of()));
        missions.add(mission(1, 3, List.of(0)));
        missions.add(mission(2, 7, List.of(0)));
        missions.add(mission(3, 5, List.of(1, 2)));
        assertEquals(List.of(0, 1, 2, 3), MissionControl.DependencyPlan.topological(missions));
        assertEquals(14, MissionControl.DependencyPlan.criticalPath(missions));
        assertEquals(0, MissionControl.DependencyPlan.readiness(missions.require(3), missions));
        missions.require(1).status = MissionControl.Status.FAILED;
        assertEquals(-1, MissionControl.DependencyPlan.readiness(missions.require(3), missions));
        MissionControl.Repository<MissionControl.Mission> cycle = new MissionControl.Repository<>();
        cycle.add(mission(0, 1, List.of(1)));
        cycle.add(mission(1, 1, List.of(0)));
        assertThrows(IllegalArgumentException.class, () -> MissionControl.DependencyPlan.topological(cycle));
        assertThrows(IllegalArgumentException.class, () -> missions.add(mission(0, 1, List.of())));
    }

    @Test
    void fuelLedgerAcceptsExactBalanceAndConservesEveryUnit() {
        MissionControl.FuelLedger ledger = new MissionControl.FuelLedger(100);
        assertTrue(ledger.reserve(100));
        assertFalse(ledger.reserve(1));
        assertEquals(0, ledger.available);
        ledger.settle(40, true);
        ledger.settle(60, false);
        assertEquals(60, ledger.available);
        assertEquals(40, ledger.spent);
        assertEquals(0, ledger.reserved);
        assertThrows(IllegalArgumentException.class, () -> ledger.settle(1, false));
        assertThrows(IllegalArgumentException.class, () -> ledger.reserve(-1));
    }

    @Test
    void uncommittedReservationsReleaseSlotsAndRefundFuelEvenOnFailure() throws Exception {
        MissionControl.FuelLedger ledger = new MissionControl.FuelLedger(100);
        MissionControl.SlotPool slots = new MissionControl.SlotPool(1);
        try (var reservation = new MissionControl.LaunchReservation(ledger, slots, 1, 101)) {
            MissionControl.MissionFailure error = assertThrows(MissionControl.MissionFailure.class, reservation::prepare);
            assertEquals(MissionControl.Fault.NO_FUEL, error.fault);
        }
        assertTrue(slots.owners.isEmpty());
        assertEquals(100, ledger.available);
        try (var reservation = new MissionControl.LaunchReservation(ledger, slots, 2, 75)) {
            reservation.prepare();
            assertEquals(75, ledger.reserved);
        }
        assertTrue(slots.owners.isEmpty());
        assertEquals(100, ledger.available);
        try (var reservation = new MissionControl.LaunchReservation(ledger, slots, 3, 50)) {
            reservation.prepare();
            reservation.commit();
        }
        assertEquals(Set.of(3), slots.owners);
        assertEquals(50, ledger.reserved);
        ledger.settle(50, true);
        slots.release(3);
        assertEquals(50, ledger.spent);
    }

    @Test
    void fuelFormulaIncludesPayloadTravelAndKindFee() {
        MissionControl.Route route = new MissionControl.Route(List.of(0, 1), 7);
        assertEquals(33, MissionControl.Scheduler.fuelCost(mission(0, 1, List.of()), route));
        MissionControl.Mission rescue = new MissionControl.Mission(1, MissionControl.MissionKind.RESCUE,
                1, 2, 1, 20, 10, List.of());
        assertEquals(27, MissionControl.Scheduler.fuelCost(rescue, route));
        assertEquals(9, MissionControl.Scheduler.riskTolerance(rescue));
    }

    @Test
    void stateMachineRejectsTransitionsAfterCompletion() {
        MissionControl.Mission item = mission(1, 2, List.of());
        assertThrows(IllegalStateException.class, () -> item.transition(MissionControl.Status.RUNNING, 0));
        item.transition(MissionControl.Status.READY, 1);
        item.transition(MissionControl.Status.RUNNING, 2);
        item.transition(MissionControl.Status.SUCCEEDED, 4);
        assertEquals(2, item.startedAt);
        assertEquals(4, item.finishedAt);
        assertThrows(IllegalStateException.class, () -> item.transition(MissionControl.Status.READY, 5));
    }

    @Test
    void simulationReplaysExactlyAndLeaksNoFuelOrSlotsAcrossSeeds() throws Exception {
        for (int seed = 0; seed < 6; seed++) {
            MissionControl.Simulation simulation = MissionControl.Simulation.create(new MissionControl.Config(60, seed, 500));
            MissionControl.MissionReport report = simulation.run();
            assertTrue(simulation.slots.owners.isEmpty());
            assertEquals(0, simulation.ledger.reserved);
            assertEquals(simulation.ledger.initial, simulation.ledger.available + simulation.ledger.spent);
            Map<Integer, MissionControl.Status> replay = simulation.journal.replay();
            assertEquals(60, replay.size());
            for (MissionControl.Mission item : simulation.missions.values()) {
                assertTrue(item.status.terminal());
                assertEquals(item.status, replay.get(item.id));
                if (item.status == MissionControl.Status.SUCCEEDED) {
                    for (int dependency : item.dependencies) {
                        assertEquals(MissionControl.Status.SUCCEEDED, simulation.missions.require(dependency).status);
                    }
                }
            }
            assertTrue(report.scheduler().slots.highWater <= report.scheduler().slots.capacity);
        }
    }

    @Test
    void tickLimitCancelsRunningMissionsAndJournalKeepsCancellationDistinct() throws Exception {
        MissionControl.Simulation simulation = MissionControl.Simulation.create(new MissionControl.Config(60, 7, 1));
        simulation.run();
        assertTrue(simulation.missions.values().stream().anyMatch(m -> m.startedAt >= 0 && m.status == MissionControl.Status.CANCELLED));
        assertTrue(simulation.slots.owners.isEmpty());
        assertEquals(0, simulation.ledger.reserved);
        for (var entry : simulation.journal.replay().entrySet()) {
            assertEquals(simulation.missions.require(entry.getKey()).status, entry.getValue());
        }
        MissionControl.EventJournal invalid = new MissionControl.EventJournal();
        invalid.append(new MissionControl.Finished(1, 2, MissionControl.Status.SUCCEEDED));
        assertThrows(IllegalStateException.class, invalid::replay);
    }

    @Test
    void emptyAndRepeatedScenariosHaveStableOutput() throws Exception {
        MissionControl.Config config = new MissionControl.Config(24, 99, 196);
        String first = MissionControl.Simulation.create(config).run().render();
        String second = MissionControl.Simulation.create(config).run().render();
        assertEquals(first, second);
        assertNotEquals(first, MissionControl.Simulation.create(new MissionControl.Config(24, 100, 196)).run().render());
        String empty = MissionControl.Simulation.create(new MissionControl.Config(0, 1, 52)).run().render();
        assertTrue(empty.contains("status -\n"));
        assertTrue(empty.contains("fuel initial=200 available=200 reserved=0 spent=0"));
        assertTrue(empty.contains("telemetry samples=0 badRows=0"));
    }

    @Test
    void csvQuotesEscapesInvalidRowsAndNumericRanges() throws Exception {
        assertEquals(List.of("a,b", "c\"d", ""), MissionControl.Telemetry.csv("\"a,b\",\"c\"\"d\","));
        assertThrows(IllegalArgumentException.class, () -> MissionControl.Telemetry.csv("\"unfinished"));
        assertThrows(IllegalArgumentException.class, () -> MissionControl.Telemetry.csv("\"done\"x"));
        List<String> errors = new ArrayList<>();
        String input = """
                # telemetry
                0,1,220,NORMAL,"sensor, nominal"
                bad,row
                2,1,190,CRITICAL,low
                3,1,1200,NORMAL,outside
                """;
        var samples = MissionControl.Telemetry.read(input, errors);
        assertEquals(2, samples.size());
        assertEquals(2, errors.size());
        assertEquals("sensor, nominal", samples.get(0).note());
        assertEquals(Map.of(1, 1), MissionControl.Telemetry.longestLowVoltage(samples, 210));
        var critical = new MissionControl.Sample(0, 2, 180, MissionControl.Severity.CRITICAL, "low");
        assertEquals(new MissionControl.Coordinate(0, 2),
                MissionControl.Telemetry.firstCriticalWindow(List.of(critical, critical), 2).orElseThrow());
    }

    @Test
    void mergeSortInversionsMatchQuadraticOracleAndLisKnownCases() {
        SplittableRandom random = new SplittableRandom(77);
        for (int trial = 0; trial < 40; trial++) {
            int[] values = random.ints(25, -5, 6).toArray();
            long expectedInversions = 0;
            for (int left = 0; left < values.length; left++) {
                for (int right = left + 1; right < values.length; right++) {
                    if (values[left] > values[right]) expectedInversions++;
                }
            }
            int[] sorted = values.clone();
            Arrays.sort(sorted);
            assertEquals(expectedInversions, MissionControl.AlgorithmLab.mergeSort(values));
            assertArrayEquals(sorted, values);
        }
        assertEquals(4, MissionControl.AlgorithmLab.longestIncreasing(new int[]{10, 9, 2, 5, 3, 7, 101, 18}));
        assertEquals(0, MissionControl.AlgorithmLab.longestIncreasing(new int[]{}));
        assertEquals(1, MissionControl.AlgorithmLab.longestIncreasing(new int[]{2, 2, 2}));
    }

    @Test
    void knapsackAndSlidingWindowMatchExhaustiveOracles() {
        int[] weights = {2, 3, 5, 7, 11};
        int[] rewards = {7, 10, 15, 20, 31};
        for (int capacity = 0; capacity < 30; capacity++) {
            int expected = 0;
            for (int mask = 0; mask < 1 << weights.length; mask++) {
                int weight = 0;
                int reward = 0;
                for (int bit = 0; bit < weights.length; bit++) {
                    if ((mask & (1 << bit)) != 0) {
                        weight += weights[bit];
                        reward += rewards[bit];
                    }
                }
                if (weight <= capacity) expected = Math.max(expected, reward);
            }
            assertEquals(expected, MissionControl.AlgorithmLab.knapsack(weights, rewards, capacity));
        }
        int[] values = {5, 0, 2, 8, 1, 3, 0};
        for (int budget = 0; budget < 20; budget++) {
            int longest = 0;
            for (int start = 0; start < values.length; start++) {
                int sum = 0;
                for (int end = start; end < values.length; end++) {
                    sum += values[end];
                    if (sum <= budget) longest = Math.max(longest, end - start + 1);
                }
            }
            assertEquals(longest, MissionControl.AlgorithmLab.longestAffordableWindow(values, budget));
        }
    }

    @Test
    void prefixBoundsNextGreaterGridPathsAndMemoizedRecursion() {
        assertEquals(12, MissionControl.AlgorithmLab.rangeSum(MissionControl.AlgorithmLab.prefix(new int[]{3, 5, 7}), 1, 3));
        assertThrows(IllegalArgumentException.class, () -> MissionControl.AlgorithmLab.rangeSum(new long[]{0, 1}, 0, 2));
        assertArrayEquals(new int[]{1, 3, 3, -1}, MissionControl.AlgorithmLab.nextGreater(new int[]{2, 4, 1, 5}));
        assertEquals(6, MissionControl.AlgorithmLab.pathCount(3, 3, Set.of()));
        assertEquals(2, MissionControl.AlgorithmLab.pathCount(3, 3, Set.of(new MissionControl.Coordinate(1, 1))));
        assertEquals(0, MissionControl.AlgorithmLab.pathCount(3, 3, Set.of(new MissionControl.Coordinate(0, 0))));
        assertEquals(6765, MissionControl.AlgorithmLab.fibonacci(20));
        assertEquals(197, MissionControl.AlgorithmLab.geometricWork(100));
        assertEquals(2, MissionControl.AlgorithmLab.lowerBound(new int[]{1, 2, 4, 4, 9}, 4));
    }

    @Test
    void unionFindCleanupSuppressedExceptionsAndJava21Patterns() {
        MissionControl.DisjointSet sets = new MissionControl.DisjointSet(5);
        assertTrue(sets.union(0, 1));
        assertTrue(sets.union(1, 2));
        assertFalse(sets.union(0, 2));
        assertEquals(3, sets.components);
        assertEquals(sets.find(0), sets.find(2));
        assertEquals(List.of("open:first", "open:second", "body:first+second", "close:second", "close:first",
                "catch:body failed", "suppressed:2", "finally"), MissionControl.cleanupTrace(true, true));
        assertEquals(List.of("open:first", "open:second", "body:first+second", "close:second", "close:first",
                "finally", "after"), MissionControl.cleanupTrace(false, false));
        assertEquals(10, MissionControl.labeledWalk(new int[][]{{1, 2}, {3, -1, 9}, {4, 99, 8}}));
        assertEquals("coordinate:2:7", MissionControl.classifyObject(new MissionControl.Coordinate(2, 7)));
        assertEquals("negative", MissionControl.classifyObject(-3));
        assertEquals("null", MissionControl.classifyObject(null));
    }
}
