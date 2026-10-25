import java.io.BufferedReader;
import java.io.IOException;
import java.io.StringReader;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.PriorityQueue;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Collectors;

/**
 * Deterministic space-mission simulator and Java 21 visual-editor stress case.
 * Input: mission count (0..300), seed, optionally a tick limit (1..2000).
 * No external services, threads, filesystem writes, or wall-clock dependencies.
 */
public final class MissionControl {
    static final long INF = Long.MAX_VALUE / 8;
    static final int MAX_MISSIONS = 300;

    private MissionControl() {
    }

    public static void main(String[] args) throws IOException {
        BufferedReader reader = new BufferedReader(new java.io.InputStreamReader(System.in));
        Config config = Config.parse(reader.readLine());
        Simulation simulation = Simulation.create(config);
        MissionReport report = simulation.run();
        System.out.print(report.render());
    }

    record Config(int size, long seed, int ticks) {
        Config {
            if (size < 0 || size > MAX_MISSIONS) {
                throw new IllegalArgumentException("mission count outside 0..300");
            }
            if (ticks < 1 || ticks > 2000) {
                throw new IllegalArgumentException("tick limit outside 1..2000");
            }
        }

        static Config defaults() {
            return new Config(48, 2048, 340);
        }

        static Config parse(String line) {
            if (line == null || line.isBlank()) {
                return defaults();
            }
            String[] parts = line.trim().split("\\s+");
            try {
                int count = Integer.parseInt(parts[0]);
                long seed = parts.length > 1 ? Long.parseLong(parts[1]) : 2048;
                int size = Math.max(0, Math.min(MAX_MISSIONS, count));
                int ticks = parts.length > 2 ? Integer.parseInt(parts[2]) : size * 6 + 52;
                return new Config(size, seed, Math.max(1, Math.min(2000, ticks)));
            } catch (NumberFormatException ex) {
                return defaults();
            }
        }
    }

    enum MissionKind {
        SURVEY, REPAIR, RELAY, RESCUE, SCIENCE
    }

    enum Status {
        PLANNED, READY, RUNNING, SUCCEEDED, FAILED, BLOCKED, CANCELLED;

        boolean terminal() {
            return switch (this) {
                case SUCCEEDED, FAILED, BLOCKED, CANCELLED -> true;
                default -> false;
            };
        }
    }

    enum Fault {
        NO_ROUTE, NO_SLOT, NO_FUEL, DEADLINE, TELEMETRY, DEPENDENCY
    }

    enum Severity {
        NORMAL, WARNING, CRITICAL
    }

    record Edge(int from, int to, int latency, int risk) {
        Edge {
            if (from < 0 || to < 0 || latency <= 0 || risk < 0) {
                throw new IllegalArgumentException("invalid edge");
            }
        }
    }

    record Route(List<Integer> stations, long latency) {
        Route {
            stations = List.copyOf(stations);
            if (stations.isEmpty() || latency < 0) {
                throw new IllegalArgumentException("invalid route");
            }
        }
    }

    record QueueEntry(int station, long distance) {
    }

    record Coordinate(int row, int column) {
    }

    static final class MissionFailure extends Exception {
        private static final long serialVersionUID = 1L;
        final Fault fault;

        MissionFailure(Fault fault, String detail) {
            super(detail);
            this.fault = fault;
        }
    }

    interface Identified {
        int id();

        default String key() {
            return "item-" + id();
        }
    }

    static final class Repository<T extends Identified> {
        private final Map<Integer, T> items = new LinkedHashMap<>();

        void add(T item) {
            if (items.putIfAbsent(item.id(), item) != null) {
                throw new IllegalArgumentException("duplicate id " + item.id());
            }
        }

        T require(int id) {
            T value = items.get(id);
            if (value == null) {
                throw new IllegalArgumentException("unknown id " + id);
            }
            return value;
        }

        Optional<T> first(Predicate<T> predicate) {
            return items.values().stream().filter(predicate).findFirst();
        }

        List<T> values() {
            return List.copyOf(items.values());
        }

        <R> List<R> project(Function<T, R> mapper) {
            return items.values().stream().map(mapper).toList();
        }
    }

    static final class Mission implements Identified {
        final int id;
        final MissionKind kind;
        final int destination;
        final int mass;
        final int duration;
        final int deadline;
        final int priority;
        final List<Integer> dependencies;
        Status status = Status.PLANNED;
        int startedAt = -1;
        int finishedAt = -1;
        Fault fault;

        Mission(int id, MissionKind kind, int destination, int mass,
                int duration, int deadline, int priority, List<Integer> dependencies) {
            if (id < 0 || destination < 0 || mass < 0 || duration < 1 || deadline < 1) {
                throw new IllegalArgumentException("invalid mission");
            }
            this.id = id;
            this.kind = Objects.requireNonNull(kind);
            this.destination = destination;
            this.mass = mass;
            this.duration = duration;
            this.deadline = deadline;
            this.priority = priority;
            this.dependencies = List.copyOf(dependencies);
        }

        @Override
        public int id() {
            return id;
        }

        void transition(Status next, int tick) {
            boolean allowed = switch (status) {
                case PLANNED -> next == Status.READY || next == Status.BLOCKED || next == Status.CANCELLED;
                case READY -> next == Status.RUNNING || next == Status.FAILED || next == Status.CANCELLED;
                case RUNNING -> next == Status.SUCCEEDED || next == Status.FAILED || next == Status.CANCELLED;
                default -> false;
            };
            if (!allowed) {
                throw new IllegalStateException(status + " -> " + next);
            }
            status = next;
            if (next == Status.RUNNING) {
                startedAt = tick;
            }
            if (next.terminal()) {
                finishedAt = tick;
            }
        }
    }

    static final class Network {
        final List<List<Edge>> outgoing;
        final Set<Long> closed = new HashSet<>();

        Network(int stations) {
            if (stations < 1) {
                throw new IllegalArgumentException("empty network");
            }
            outgoing = new ArrayList<>();
            for (int station = 0; station < stations; station++) {
                outgoing.add(new ArrayList<>());
            }
        }

        int size() {
            return outgoing.size();
        }

        void check(int station) {
            if (station < 0 || station >= size()) {
                throw new IllegalArgumentException("station " + station);
            }
        }

        void connect(int from, int to, int latency, int risk) {
            check(from);
            check(to);
            outgoing.get(from).add(new Edge(from, to, latency, risk));
        }

        static long link(int from, int to) {
            return ((long) from << 32) ^ Integer.toUnsignedLong(to);
        }

        void close(int from, int to) {
            check(from);
            check(to);
            closed.add(link(from, to));
        }

        void reopen(int from, int to) {
            closed.remove(link(from, to));
        }

        boolean usable(Edge edge, int maxRisk) {
            return edge.risk() <= maxRisk && !closed.contains(link(edge.from(), edge.to()));
        }

        Optional<Route> shortest(int from, int to, int maxRisk) {
            check(from);
            check(to);
            long[] distances = new long[size()];
            int[] previous = new int[size()];
            Arrays.fill(distances, INF);
            Arrays.fill(previous, -1);
            PriorityQueue<QueueEntry> queue = new PriorityQueue<>(
                    Comparator.comparingLong(QueueEntry::distance).thenComparingInt(QueueEntry::station));
            distances[from] = 0;
            queue.add(new QueueEntry(from, 0));
            while (!queue.isEmpty()) {
                QueueEntry current = queue.remove();
                if (current.distance() != distances[current.station()]) {
                    continue;
                }
                if (current.station() == to) {
                    break;
                }
                for (Edge edge : outgoing.get(current.station())) {
                    if (!usable(edge, maxRisk)) {
                        continue;
                    }
                    long candidate = current.distance() + edge.latency();
                    if (candidate < distances[edge.to()]) {
                        distances[edge.to()] = candidate;
                        previous[edge.to()] = current.station();
                        queue.add(new QueueEntry(edge.to(), candidate));
                    }
                }
            }
            if (distances[to] == INF) {
                return Optional.empty();
            }
            Deque<Integer> path = new ArrayDeque<>();
            int station = to;
            while (station != -1) {
                path.addFirst(station);
                if (station == from) {
                    break;
                }
                station = previous[station];
            }
            if (path.getFirst() != from) {
                throw new IllegalStateException("broken predecessor chain");
            }
            return Optional.of(new Route(new ArrayList<>(path), distances[to]));
        }

        List<Integer> breadthFirst(int from, int maxRisk) {
            check(from);
            boolean[] seen = new boolean[size()];
            Deque<Integer> queue = new ArrayDeque<>();
            List<Integer> visited = new ArrayList<>();
            queue.add(from);
            seen[from] = true;
            while (!queue.isEmpty()) {
                int station = queue.removeFirst();
                visited.add(station);
                for (Edge edge : outgoing.get(station)) {
                    if (usable(edge, maxRisk) && !seen[edge.to()]) {
                        seen[edge.to()] = true;
                        queue.addLast(edge.to());
                    }
                }
            }
            return visited;
        }

        List<Integer> depthFirst(int from, int maxRisk) {
            check(from);
            List<Integer> order = new ArrayList<>();
            boolean[] seen = new boolean[size()];
            visit(from, maxRisk, seen, order);
            return order;
        }

        private void visit(int station, int maxRisk, boolean[] seen, List<Integer> order) {
            if (seen[station]) {
                return;
            }
            seen[station] = true;
            order.add(station);
            for (Edge edge : outgoing.get(station)) {
                if (usable(edge, maxRisk)) {
                    visit(edge.to(), maxRisk, seen, order);
                }
            }
        }

        long[][] allPairs(int maxRisk) {
            int count = size();
            long[][] result = new long[count][count];
            for (int row = 0; row < count; row++) {
                Arrays.fill(result[row], INF);
                result[row][row] = 0;
                for (Edge edge : outgoing.get(row)) {
                    if (usable(edge, maxRisk)) {
                        result[row][edge.to()] = Math.min(result[row][edge.to()], edge.latency());
                    }
                }
            }
            for (int pivot = 0; pivot < count; pivot++) {
                for (int from = 0; from < count; from++) {
                    if (result[from][pivot] == INF) {
                        continue;
                    }
                    for (int to = 0; to < count; to++) {
                        long candidate = result[from][pivot] + result[pivot][to];
                        if (candidate < result[from][to]) {
                            result[from][to] = candidate;
                        }
                    }
                }
            }
            return result;
        }

        long reachableDistanceSum() {
            long sum = 0;
            long[][] distances = allPairs(9);
            for (long[] row : distances) {
                for (long value : row) {
                    if (value != INF) {
                        sum += value;
                    }
                }
            }
            return sum;
        }
    }

    static final class DependencyPlan {
        static List<Integer> topological(Repository<Mission> missions) {
            Map<Integer, Integer> incoming = new TreeMap<>();
            Map<Integer, List<Integer>> dependents = new TreeMap<>();
            for (Mission mission : missions.values()) {
                incoming.put(mission.id, mission.dependencies.size());
                for (int dependency : mission.dependencies) {
                    missions.require(dependency);
                    dependents.computeIfAbsent(dependency, ignored -> new ArrayList<>()).add(mission.id);
                }
            }
            PriorityQueue<Integer> ready = new PriorityQueue<>();
            for (var entry : incoming.entrySet()) {
                if (entry.getValue() == 0) {
                    ready.add(entry.getKey());
                }
            }
            List<Integer> order = new ArrayList<>();
            while (!ready.isEmpty()) {
                int id = ready.remove();
                order.add(id);
                for (int dependent : dependents.getOrDefault(id, List.of())) {
                    int left = incoming.compute(dependent, (ignored, value) -> value - 1);
                    if (left == 0) {
                        ready.add(dependent);
                    }
                }
            }
            if (order.size() != missions.values().size()) {
                throw new IllegalArgumentException("cyclic mission dependencies");
            }
            return order;
        }

        static int criticalPath(Repository<Mission> missions) {
            Map<Integer, Integer> longest = new HashMap<>();
            int result = 0;
            for (int id : topological(missions)) {
                Mission mission = missions.require(id);
                int prefix = 0;
                for (int dependency : mission.dependencies) {
                    prefix = Math.max(prefix, longest.get(dependency));
                }
                int finish = prefix + mission.duration;
                longest.put(id, finish);
                result = Math.max(result, finish);
            }
            return result;
        }

        static int readiness(Mission mission, Repository<Mission> missions) {
            boolean waiting = false;
            for (int dependency : mission.dependencies) {
                Status status = missions.require(dependency).status;
                if (status.terminal() && status != Status.SUCCEEDED) {
                    return -1;
                }
                if (status != Status.SUCCEEDED) {
                    waiting = true;
                }
            }
            return waiting ? 0 : 1;
        }
    }

    static final class FuelLedger {
        final long initial;
        long available;
        long reserved;
        long spent;
        int reservations;
        int refunds;

        FuelLedger(long initial) {
            if (initial < 0) {
                throw new IllegalArgumentException("negative fuel");
            }
            this.initial = initial;
            this.available = initial;
        }

        boolean reserve(long amount) {
            if (amount < 0) {
                throw new IllegalArgumentException("negative reservation");
            }
            if (amount > available) {
                return false;
            }
            available -= amount;
            reserved += amount;
            reservations++;
            check();
            return true;
        }

        void settle(long amount, boolean success) {
            if (amount < 0 || amount > reserved) {
                throw new IllegalArgumentException("invalid settlement");
            }
            reserved -= amount;
            if (success) {
                spent += amount;
            } else {
                available += amount;
                refunds++;
            }
            check();
        }

        void check() {
            if (available < 0 || reserved < 0 || spent < 0 || available + reserved + spent != initial) {
                throw new IllegalStateException("fuel conservation violated");
            }
        }
    }

    static final class SlotPool {
        final int capacity;
        final Set<Integer> owners = new LinkedHashSet<>();
        int highWater;

        SlotPool(int capacity) {
            if (capacity < 1) {
                throw new IllegalArgumentException("zero launch slots");
            }
            this.capacity = capacity;
        }

        boolean acquire(int id) {
            if (owners.contains(id)) {
                throw new IllegalArgumentException("duplicate lease");
            }
            if (owners.size() == capacity) {
                return false;
            }
            owners.add(id);
            highWater = Math.max(highWater, owners.size());
            return true;
        }

        void release(int id) {
            if (!owners.remove(id)) {
                throw new IllegalArgumentException("unknown lease");
            }
        }
    }

    static final class LaunchReservation implements AutoCloseable {
        final FuelLedger ledger;
        final SlotPool slots;
        final int missionId;
        final long cost;
        boolean slotHeld;
        boolean fuelHeld;
        boolean committed;
        boolean closed;

        LaunchReservation(FuelLedger ledger, SlotPool slots, int missionId, long cost) {
            this.ledger = ledger;
            this.slots = slots;
            this.missionId = missionId;
            this.cost = cost;
        }

        void prepare() throws MissionFailure {
            if (closed || slotHeld) {
                throw new IllegalStateException("reservation already used");
            }
            if (!slots.acquire(missionId)) {
                throw new MissionFailure(Fault.NO_SLOT, "no launch slot");
            }
            slotHeld = true;
            if (!ledger.reserve(cost)) {
                throw new MissionFailure(Fault.NO_FUEL, "insufficient fuel");
            }
            fuelHeld = true;
        }

        void commit() {
            if (!fuelHeld || closed) {
                throw new IllegalStateException("unprepared reservation");
            }
            committed = true;
        }

        @Override
        public void close() {
            if (closed) {
                return;
            }
            closed = true;
            if (committed) {
                return;
            }
            try {
                if (fuelHeld) {
                    ledger.settle(cost, false);
                }
            } finally {
                if (slotHeld) {
                    slots.release(missionId);
                }
            }
        }
    }

    sealed interface Event permits Started, Finished, Rejected, LinkChanged {
        int tick();
    }

    record Started(int tick, int missionId, long fuel, int arrival) implements Event {
    }

    record Finished(int tick, int missionId, Status status) implements Event {
        Finished {
            if (status != Status.SUCCEEDED && status != Status.FAILED && status != Status.CANCELLED) {
                throw new IllegalArgumentException("invalid completion status");
            }
        }
    }

    record Rejected(int tick, int missionId, Fault reason) implements Event {
    }

    record LinkChanged(int tick, int from, int to, boolean closed) implements Event {
    }

    static final class EventJournal {
        final List<Event> events = new ArrayList<>();
        final EnumMap<Fault, Integer> faults = new EnumMap<>(Fault.class);
        long hash = 0xcbf29ce484222325L;

        void append(Event event) {
            if (!events.isEmpty() && event.tick() < events.get(events.size() - 1).tick()) {
                throw new IllegalArgumentException("journal time moved backwards");
            }
            events.add(event);
            String text = describe(event);
            for (int i = 0; i < text.length(); i++) {
                hash ^= text.charAt(i);
                hash *= 0x100000001b3L;
            }
            if (event instanceof Rejected rejected) {
                faults.merge(rejected.reason(), 1, Integer::sum);
            }
        }

        static String describe(Event event) {
            return switch (event) {
                case Started started -> "start:" + started.tick() + ":" + started.missionId() + ":" + started.fuel() + ":" + started.arrival();
                case Finished finished -> "finish:" + finished.tick() + ":" + finished.missionId() + ":" + finished.status();
                case Rejected rejected -> {
                    String fault = rejected.reason().name().toLowerCase(Locale.ROOT);
                    yield "reject:" + rejected.tick() + ":" + rejected.missionId() + ":" + fault;
                }
                case LinkChanged link -> "link:" + link.tick() + ":" + link.from() + ":" + link.to() + ":" + link.closed();
            };
        }

        Map<Integer, Status> replay() {
            Map<Integer, Status> states = new TreeMap<>();
            for (Event event : events) {
                switch (event) {
                    case Started started -> {
                        if (states.putIfAbsent(started.missionId(), Status.RUNNING) != null) {
                            throw new IllegalStateException("mission launched twice");
                        }
                    }
                    case Finished finished -> {
                        if (states.get(finished.missionId()) != Status.RUNNING) {
                            throw new IllegalStateException("completion without start");
                        }
                        states.put(finished.missionId(), finished.status());
                    }
                    case Rejected rejected -> {
                        if (states.containsKey(rejected.missionId())) {
                            throw new IllegalStateException("rejection after launch");
                        }
                        Status state = switch (rejected.reason()) {
                            case DEPENDENCY -> Status.BLOCKED;
                            case DEADLINE -> Status.CANCELLED;
                            default -> Status.FAILED;
                        };
                        states.put(rejected.missionId(), state);
                    }
                    case LinkChanged ignored -> {
                        // Link events affect routes, not mission state.
                    }
                }
            }
            return states;
        }
    }

    record Running(Mission mission, int finishAt, long fuel, boolean willFail) {
    }

    static final class Scheduler {
        final Repository<Mission> missions;
        final Network network;
        final FuelLedger ledger;
        final SlotPool slots;
        final EventJournal journal;
        final Map<Integer, Running> running = new TreeMap<>();
        int planningAttempts;
        int deferred;
        int ticks;

        Scheduler(Repository<Mission> missions, Network network, FuelLedger ledger,
                  SlotPool slots, EventJournal journal) {
            this.missions = missions;
            this.network = network;
            this.ledger = ledger;
            this.slots = slots;
            this.journal = journal;
        }

        static long fuelCost(Mission mission, Route route) {
            long payload = mission.mass * 3L;
            long travel = route.latency() * 2;
            long kindFee;
            switch (mission.kind) {
                case RESCUE:
                    kindFee = 7;
                    break;
                case REPAIR:
                case RELAY:
                    kindFee = 11;
                    break;
                case SURVEY:
                    kindFee = 13;
                    break;
                default:
                    kindFee = 17;
            }
            return payload + travel + kindFee;
        }

        static int riskTolerance(Mission mission) {
            int tolerance;
            if (mission.priority >= 8) {
                if (mission.kind == MissionKind.RESCUE) {
                    if (mission.mass <= 12) {
                        tolerance = 9;
                    } else {
                        tolerance = 7;
                    }
                } else {
                    tolerance = 6;
                }
            } else {
                tolerance = mission.kind == MissionKind.SCIENCE ? 3 : 5;
            }
            return tolerance;
        }

        void refreshReady(int tick) {
            for (Mission mission : missions.values()) {
                if (mission.status != Status.PLANNED) {
                    continue;
                }
                int readiness = DependencyPlan.readiness(mission, missions);
                if (readiness < 0) {
                    reject(mission, Status.BLOCKED, Fault.DEPENDENCY, tick);
                } else if (readiness > 0) {
                    mission.transition(Status.READY, tick);
                }
            }
        }

        List<Mission> readyOrder() {
            List<Mission> ready = missions.values().stream()
                    .filter(mission -> mission.status == Status.READY)
                    .collect(Collectors.toCollection(ArrayList::new));
            ready.sort(Comparator.comparingInt((Mission mission) -> mission.priority).reversed()
                    .thenComparingInt(mission -> mission.deadline)
                    .thenComparingInt(mission -> mission.id));
            return ready;
        }

        void launch(Mission mission, int tick) throws MissionFailure {
            planningAttempts++;
            Route route = network.shortest(0, mission.destination, riskTolerance(mission))
                    .orElseThrow(() -> new MissionFailure(Fault.NO_ROUTE, "no safe route"));
            long fuel = fuelCost(mission, route);
            try (LaunchReservation reservation = new LaunchReservation(ledger, slots, mission.id, fuel)) {
                try {
                    reservation.prepare();
                    int travelTicks = (int) ((route.latency() + 3) / 4);
                    int finish = tick + travelTicks + mission.duration;
                    if (finish > mission.deadline) {
                        throw new MissionFailure(Fault.DEADLINE, "arrival misses deadline");
                    }
                    boolean fail = mission.id % 17 == 11 && mission.kind != MissionKind.RESCUE;
                    Running active = new Running(mission, finish, fuel, fail);
                    running.put(mission.id, active);
                    mission.transition(Status.RUNNING, tick);
                    journal.append(new Started(tick, mission.id, fuel, finish));
                    reservation.commit();
                } catch (MissionFailure failure) {
                    if (failure.fault == Fault.NO_SLOT) {
                        deferred++;
                    }
                    throw failure;
                } finally {
                    ledger.check();
                }
            }
        }

        void dispatch(int tick) {
            for (Mission mission : readyOrder()) {
                try {
                    launch(mission, tick);
                } catch (MissionFailure failure) {
                    switch (failure.fault) {
                        case NO_SLOT:
                            continue;
                        case DEADLINE:
                            reject(mission, Status.CANCELLED, failure.fault, tick);
                            break;
                        default:
                            reject(mission, Status.FAILED, failure.fault, tick);
                    }
                }
            }
        }

        void complete(int tick) {
            List<Integer> completed = new ArrayList<>();
            for (Running active : running.values()) {
                if (active.finishAt() > tick) {
                    continue;
                }
                Mission mission = active.mission();
                boolean success = !active.willFail();
                try {
                    ledger.settle(active.fuel(), success);
                    mission.transition(success ? Status.SUCCEEDED : Status.FAILED, tick);
                    if (!success) {
                        mission.fault = Fault.TELEMETRY;
                    }
                    journal.append(new Finished(tick, mission.id, success ? Status.SUCCEEDED : Status.FAILED));
                } finally {
                    slots.release(mission.id);
                    completed.add(mission.id);
                }
            }
            completed.forEach(running::remove);
        }

        void reject(Mission mission, Status status, Fault fault, int tick) {
            mission.fault = fault;
            mission.transition(status, tick);
            journal.append(new Rejected(tick, mission.id, fault));
        }

        void perturbLinks(int tick) {
            if (network.size() < 3) {
                return;
            }
            if (tick == 3) {
                network.close(0, 1);
                journal.append(new LinkChanged(tick, 0, 1, true));
            } else if (tick == 9) {
                network.reopen(0, 1);
                journal.append(new LinkChanged(tick, 0, 1, false));
            }
        }

        void cancelRemaining(int tick) {
            for (Running active : new ArrayList<>(running.values())) {
                ledger.settle(active.fuel(), false);
                slots.release(active.mission().id);
                active.mission().transition(Status.CANCELLED, tick);
                journal.append(new Finished(tick, active.mission().id, Status.CANCELLED));
            }
            running.clear();
            for (Mission mission : missions.values()) {
                if (!mission.status.terminal()) {
                    reject(mission, Status.CANCELLED, Fault.DEADLINE, tick);
                }
            }
        }

        void run(int tickLimit) {
            DependencyPlan.topological(missions);
            int tick = 0;
            do {
                complete(tick);
                perturbLinks(tick);
                refreshReady(tick);
                dispatch(tick);
                ticks = tick;
                boolean allTerminal = missions.values().stream().allMatch(mission -> mission.status.terminal());
                if (allTerminal) {
                    break;
                }
                tick++;
            } while (tick < tickLimit);
            if (!running.isEmpty() || missions.values().stream().anyMatch(mission -> !mission.status.terminal())) {
                ticks = tickLimit;
                cancelRemaining(tickLimit);
            }
            ledger.check();
            if (!slots.owners.isEmpty() || ledger.reserved != 0) {
                throw new IllegalStateException("resource leak after simulation");
            }
        }
    }

    record Sample(int tick, int station, int voltage, Severity severity, String note) {
    }

    static final class Telemetry {
        static List<String> csv(String line) {
            List<String> result = new ArrayList<>();
            StringBuilder field = new StringBuilder();
            boolean quoted = false;
            boolean closed = false;
            for (int index = 0; index < line.length(); index++) {
                char character = line.charAt(index);
                if (quoted) {
                    if (character == '"') {
                        if (index + 1 < line.length() && line.charAt(index + 1) == '"') {
                            field.append('"');
                            index++;
                        } else {
                            quoted = false;
                            closed = true;
                        }
                    } else {
                        field.append(character);
                    }
                } else if (character == ',') {
                    result.add(field.toString());
                    field.setLength(0);
                    closed = false;
                } else if (character == '"') {
                    if (field.length() != 0 || closed) {
                        throw new IllegalArgumentException("quote in unquoted field");
                    }
                    quoted = true;
                } else {
                    if (closed) {
                        throw new IllegalArgumentException("characters after closing quote");
                    }
                    field.append(character);
                }
            }
            if (quoted) {
                throw new IllegalArgumentException("unterminated quote");
            }
            result.add(field.toString());
            return result;
        }

        static Sample parse(String line) {
            List<String> values = csv(line);
            if (values.size() != 5) {
                throw new IllegalArgumentException("expected five fields");
            }
            int tick = Integer.parseInt(values.get(0));
            int station = Integer.parseInt(values.get(1));
            int voltage = Integer.parseInt(values.get(2));
            Severity severity = Severity.valueOf(values.get(3));
            if (tick < 0 || station < 0 || voltage < 0 || voltage > 1000) {
                throw new IllegalArgumentException("invalid telemetry range");
            }
            return new Sample(tick, station, voltage, severity, values.get(4));
        }

        static List<Sample> read(String text, List<String> errors) throws IOException {
            List<Sample> samples = new ArrayList<>();
            try (BufferedReader reader = new BufferedReader(new StringReader(text))) {
                String line;
                int row = 0;
                while ((line = reader.readLine()) != null) {
                    row++;
                    if (line.isBlank() || line.startsWith("#")) {
                        continue;
                    }
                    try {
                        samples.add(parse(line));
                    } catch (IllegalArgumentException ex) {
                        errors.add("line " + row + ": " + ex.getClass().getSimpleName());
                    }
                }
            }
            return samples;
        }

        static String generated(int count, int stations, SplittableRandom random) {
            StringBuilder result = new StringBuilder("# tick,station,voltage,severity,note\n");
            for (int index = 0; index < count; index++) {
                int voltage = 180 + random.nextInt(90);
                Severity severity = voltage < 195 ? Severity.CRITICAL : voltage < 210 ? Severity.WARNING : Severity.NORMAL;
                String note = index % 5 == 0 ? "\"sensor, drift\"" : "stable";
                result.append(index).append(',').append(random.nextInt(stations)).append(',')
                        .append(voltage).append(',').append(severity).append(',').append(note).append('\n');
                if (index % 19 == 7) {
                    result.append("invalid,row\n");
                }
            }
            return result.toString();
        }

        static Map<Integer, Integer> longestLowVoltage(List<Sample> samples, int threshold) {
            Map<Integer, Integer> longest = new TreeMap<>();
            Map<Integer, Integer> streak = new HashMap<>();
            for (Sample sample : samples) {
                int current = sample.voltage() < threshold ? streak.getOrDefault(sample.station(), 0) + 1 : 0;
                streak.put(sample.station(), current);
                longest.merge(sample.station(), current, Math::max);
            }
            return longest;
        }

        static Optional<Coordinate> firstCriticalWindow(List<Sample> samples, int width) {
            if (width < 1) {
                throw new IllegalArgumentException("nonpositive window");
            }
            search:
            for (int start = 0; start + width <= samples.size(); start++) {
                int station = samples.get(start).station();
                for (int offset = 0; offset < width; offset++) {
                    Sample sample = samples.get(start + offset);
                    if (sample.station() != station || sample.severity() != Severity.CRITICAL) {
                        continue search;
                    }
                }
                return Optional.of(new Coordinate(start, station));
            }
            return Optional.empty();
        }
    }

    static final class AlgorithmLab {
        static long linearEnergy(int[] values) {
            long sum = 0;
            for (int index = 0; index < values.length; index++) {
                sum += values[index];
            }
            return sum;
        }

        static int lowerBound(int[] sorted, int target) {
            int left = 0;
            int right = sorted.length;
            while (left < right) {
                int middle = left + (right - left) / 2;
                if (sorted[middle] < target) {
                    left = middle + 1;
                } else {
                    right = middle;
                }
            }
            return left;
        }

        static long mergeSort(int[] values) {
            int[] buffer = new int[values.length];
            return merge(values, buffer, 0, values.length);
        }

        private static long merge(int[] values, int[] buffer, int from, int to) {
            if (to - from <= 1) {
                return 0;
            }
            int middle = from + (to - from) / 2;
            long inversions = merge(values, buffer, from, middle) + merge(values, buffer, middle, to);
            int left = from;
            int right = middle;
            int output = from;
            while (left < middle && right < to) {
                if (values[left] <= values[right]) {
                    buffer[output++] = values[left++];
                } else {
                    buffer[output++] = values[right++];
                    inversions += middle - left;
                }
            }
            while (left < middle) {
                buffer[output++] = values[left++];
            }
            while (right < to) {
                buffer[output++] = values[right++];
            }
            System.arraycopy(buffer, from, values, from, to - from);
            return inversions;
        }

        static int longestIncreasing(int[] values) {
            int[] best = new int[values.length];
            int answer = 0;
            for (int end = 0; end < values.length; end++) {
                best[end] = 1;
                for (int before = 0; before < end; before++) {
                    if (values[before] < values[end]) {
                        best[end] = Math.max(best[end], best[before] + 1);
                    }
                }
                answer = Math.max(answer, best[end]);
            }
            return answer;
        }

        static int knapsack(int[] weights, int[] rewards, int capacity) {
            if (weights.length != rewards.length || capacity < 0) {
                throw new IllegalArgumentException("invalid knapsack");
            }
            int[] best = new int[capacity + 1];
            for (int item = 0; item < weights.length; item++) {
                if (weights[item] <= 0) {
                    throw new IllegalArgumentException("nonpositive weight");
                }
                for (int available = capacity; available >= weights[item]; available--) {
                    best[available] = Math.max(best[available], best[available - weights[item]] + rewards[item]);
                }
            }
            return best[capacity];
        }

        static int longestAffordableWindow(int[] values, int budget) {
            if (budget < 0) {
                throw new IllegalArgumentException("negative budget");
            }
            int begin = 0;
            int best = 0;
            long total = 0;
            for (int end = 0; end < values.length; end++) {
                if (values[end] < 0) {
                    throw new IllegalArgumentException("negative window value");
                }
                total += values[end];
                while (total > budget && begin <= end) {
                    total -= values[begin++];
                }
                best = Math.max(best, end - begin + 1);
            }
            return best;
        }

        static int[] nextGreater(int[] values) {
            int[] result = new int[values.length];
            Arrays.fill(result, -1);
            Deque<Integer> stack = new ArrayDeque<>();
            for (int index = 0; index < values.length; index++) {
                while (!stack.isEmpty() && values[stack.peekLast()] < values[index]) {
                    result[stack.removeLast()] = index;
                }
                stack.addLast(index);
            }
            return result;
        }

        static long[] prefix(int[] values) {
            long[] sums = new long[values.length + 1];
            for (int index = 0; index < values.length; index++) {
                sums[index + 1] = sums[index] + values[index];
            }
            return sums;
        }

        static long rangeSum(long[] prefix, int from, int to) {
            if (from < 0 || to < from || to >= prefix.length) {
                throw new IllegalArgumentException("invalid half-open range");
            }
            return prefix[to] - prefix[from];
        }

        static long pathCount(int rows, int columns, Set<Coordinate> blocked) {
            if (rows < 0 || columns < 0) {
                throw new IllegalArgumentException("negative grid");
            }
            if (rows == 0 || columns == 0) {
                return 0;
            }
            if (rows > 20 || columns > 20) {
                throw new IllegalArgumentException("grid too large for long path count");
            }
            long[][] paths = new long[rows][columns];
            for (int row = 0; row < rows; row++) {
                for (int column = 0; column < columns; column++) {
                    if (blocked.contains(new Coordinate(row, column))) {
                        paths[row][column] = 0;
                        continue;
                    }
                    if (row == 0 && column == 0) {
                        paths[row][column] = 1;
                    } else {
                        long above = row == 0 ? 0 : paths[row - 1][column];
                        long before = column == 0 ? 0 : paths[row][column - 1];
                        paths[row][column] = above + before;
                    }
                }
            }
            return paths[rows - 1][columns - 1];
        }

        static int geometricWork(int n) {
            if (n < 0 || n > 1000000) {
                throw new IllegalArgumentException("geometric input outside safe range");
            }
            int work = 0;
            for (int span = n; span > 0; span /= 2) {
                for (int item = 0; item < span; item++) {
                    work++;
                }
            }
            return work;
        }

        static int fibonacci(int n) {
            if (n < 0 || n > 45) {
                throw new IllegalArgumentException("fibonacci outside safe int range");
            }
            int[] memo = new int[n + 1];
            Arrays.fill(memo, -1);
            return fibonacciMemo(n, memo);
        }

        private static int fibonacciMemo(int n, int[] memo) {
            if (n <= 1) {
                return n;
            }
            if (memo[n] >= 0) {
                return memo[n];
            }
            memo[n] = fibonacciMemo(n - 1, memo) + fibonacciMemo(n - 2, memo);
            return memo[n];
        }
    }

    static final class DisjointSet {
        final int[] parent;
        final int[] rank;
        int components;

        DisjointSet(int count) {
            if (count < 0) {
                throw new IllegalArgumentException("negative disjoint-set size");
            }
            parent = new int[count];
            rank = new int[count];
            components = count;
            for (int item = 0; item < count; item++) {
                parent[item] = item;
            }
        }

        int find(int item) {
            if (item < 0 || item >= parent.length) {
                throw new IllegalArgumentException("unknown disjoint-set item");
            }
            int root = item;
            while (parent[root] != root) {
                root = parent[root];
            }
            while (parent[item] != item) {
                int next = parent[item];
                parent[item] = root;
                item = next;
            }
            return root;
        }

        boolean union(int left, int right) {
            int first = find(left);
            int second = find(right);
            if (first == second) {
                return false;
            }
            if (rank[first] < rank[second]) {
                parent[first] = second;
            } else if (rank[first] > rank[second]) {
                parent[second] = first;
            } else {
                parent[second] = first;
                rank[first]++;
            }
            components--;
            return true;
        }
    }

    static final class CleanupProbe implements AutoCloseable {
        final String name;
        final List<String> trace;
        final boolean fail;

        CleanupProbe(String name, List<String> trace, boolean fail) {
            this.name = name;
            this.trace = trace;
            this.fail = fail;
            trace.add("open:" + name);
        }

        @Override
        public void close() throws IOException {
            trace.add("close:" + name);
            if (fail) {
                throw new IOException("close failed: " + name);
            }
        }
    }

    static List<String> cleanupTrace(boolean throwInBody, boolean failClose) {
        List<String> trace = new ArrayList<>();
        try (CleanupProbe first = new CleanupProbe("first", trace, failClose);
             CleanupProbe second = new CleanupProbe("second", trace, failClose)) {
            trace.add("body:" + first.name + "+" + second.name);
            if (throwInBody) {
                throw new IOException("body failed");
            }
        } catch (IOException failure) {
            trace.add("catch:" + failure.getMessage());
            trace.add("suppressed:" + failure.getSuppressed().length);
            return trace;
        } finally {
            trace.add("finally");
        }
        trace.add("after");
        return trace;
    }

    static int labeledWalk(int[][] grid) {
        int score = 0;
        outer:
        for (int row = 0; row < grid.length; row++) {
            for (int column = 0; column < grid[row].length; column++) {
                switch (grid[row][column]) {
                    case -1:
                        continue outer;
                    case 99:
                        break outer;
                    default:
                        score += grid[row][column];
                }
            }
        }
        return score;
    }

    static String classifyObject(Object value) {
        if (value instanceof Coordinate(int row, int column)) {
            return "coordinate:" + row + ":" + column;
        }
        if (value instanceof String text && !text.isBlank()) {
            return "text:" + text.length();
        }
        return switch (value) {
            case null -> "null";
            case Integer number when number < 0 -> "negative";
            case Integer number -> "integer:" + number;
            default -> "other";
        };
    }

    static final class Simulation {
        final Config config;
        final Network network;
        final Repository<Mission> missions;
        final FuelLedger ledger;
        final SlotPool slots;
        final EventJournal journal;
        final List<Sample> samples;
        final List<String> telemetryErrors;
        final int[] energies;

        Simulation(Config config, Network network, Repository<Mission> missions,
                   FuelLedger ledger, SlotPool slots, EventJournal journal,
                   List<Sample> samples, List<String> telemetryErrors, int[] energies) {
            this.config = config;
            this.network = network;
            this.missions = missions;
            this.ledger = ledger;
            this.slots = slots;
            this.journal = journal;
            this.samples = samples;
            this.telemetryErrors = telemetryErrors;
            this.energies = energies;
        }

        static Simulation create(Config config) throws IOException {
            SplittableRandom random = new SplittableRandom(config.seed());
            Network network = buildNetwork(Math.max(5, config.size() / 4 + 5), random.split());
            Repository<Mission> missions = buildMissions(config, network.size(), random.split());
            long fuel = config.size() * 105L + 200;
            FuelLedger ledger = new FuelLedger(fuel);
            SlotPool slots = new SlotPool(2 + config.size() % 4);
            List<String> errors = new ArrayList<>();
            String csv = Telemetry.generated(config.size() * 3, network.size(), random.split());
            List<Sample> samples = Telemetry.read(csv, errors);
            int[] energies = new int[config.size()];
            for (int index = 0; index < energies.length; index++) {
                energies[index] = 1 + random.nextInt(100);
            }
            return new Simulation(config, network, missions, ledger, slots,
                    new EventJournal(), samples, errors, energies);
        }

        static Network buildNetwork(int stations, SplittableRandom random) {
            Network network = new Network(stations);
            for (int station = 0; station < stations; station++) {
                int next = (station + 1) % stations;
                network.connect(station, next, 2 + random.nextInt(6), random.nextInt(4));
                network.connect(next, station, 3 + random.nextInt(6), random.nextInt(4));
            }
            for (int attempt = 0; attempt < stations * 3; attempt++) {
                int from = random.nextInt(stations);
                int to = random.nextInt(stations);
                if (from == to) {
                    continue;
                }
                network.connect(from, to, 1 + random.nextInt(18), random.nextInt(10));
            }
            return network;
        }

        static Repository<Mission> buildMissions(Config config, int stations, SplittableRandom random) {
            Repository<Mission> result = new Repository<>();
            MissionKind[] kinds = MissionKind.values();
            for (int id = 0; id < config.size(); id++) {
                LinkedHashSet<Integer> dependencies = new LinkedHashSet<>();
                if (id > 0 && id % 3 != 0) {
                    dependencies.add(random.nextInt(id));
                    if (id > 4 && id % 5 == 0) {
                        dependencies.add(random.nextInt(id));
                    }
                }
                int deadline = 12 + random.nextInt(config.size() * 2 + 15);
                Mission mission = new Mission(id, kinds[random.nextInt(kinds.length)],
                        random.nextInt(stations), 1 + random.nextInt(18),
                        1 + random.nextInt(9), deadline, 1 + random.nextInt(10),
                        new ArrayList<>(dependencies));
                result.add(mission);
            }
            return result;
        }

        MissionReport run() {
            Scheduler scheduler = new Scheduler(missions, network, ledger, slots, journal);
            int criticalPath = DependencyPlan.criticalPath(missions);
            scheduler.run(config.ticks());
            Map<Integer, Status> replayed = journal.replay();
            for (Mission mission : missions.values()) {
                if (replayed.get(mission.id) != mission.status) {
                    throw new IllegalStateException("replay disagrees for mission " + mission.id);
                }
            }
            long[] algorithms = algorithmFingerprint();
            Map<Integer, Integer> streaks = Telemetry.longestLowVoltage(samples, 210);
            int longestStreak = streaks.values().stream().mapToInt(Integer::intValue).max().orElse(0);
            int connectivity = connectivityComponents();
            return new MissionReport(config, scheduler, criticalPath, algorithms, longestStreak,
                    connectivity, network.reachableDistanceSum(), telemetryErrors.size(), samples.size());
        }

        long[] algorithmFingerprint() {
            int[] sorted = energies.clone();
            long inversions = AlgorithmLab.mergeSort(sorted);
            int middle = sorted.length == 0 ? 0 : sorted[sorted.length / 2];
            int lower = AlgorithmLab.lowerBound(sorted, middle);
            int[] weights = {2, 3, 5, 7, 11};
            int[] rewards = {7, 10, 15, 20, 31};
            long[] prefix = AlgorithmLab.prefix(energies);
            int[] greater = AlgorithmLab.nextGreater(energies);
            long greaterSum = 0;
            for (int index : greater) {
                greaterSum += index;
            }
            return new long[]{
                AlgorithmLab.linearEnergy(energies),
                inversions,
                AlgorithmLab.longestIncreasing(energies),
                AlgorithmLab.longestAffordableWindow(energies, 180),
                AlgorithmLab.knapsack(weights, rewards, 24),
                AlgorithmLab.pathCount(8, 9, Set.of(new Coordinate(2, 3), new Coordinate(5, 5))),
                AlgorithmLab.geometricWork(energies.length),
                AlgorithmLab.fibonacci(20),
                AlgorithmLab.rangeSum(prefix, 0, energies.length),
                greaterSum,
                lower
            };
        }

        int connectivityComponents() {
            DisjointSet set = new DisjointSet(network.size());
            for (List<Edge> edges : network.outgoing) {
                for (Edge edge : edges) {
                    if (network.usable(edge, 9)) {
                        set.union(edge.from(), edge.to());
                    }
                }
            }
            return set.components;
        }
    }

    record MissionReport(Config config, Scheduler scheduler, int criticalPath,
                         long[] algorithms, int longestStreak, int components,
                         long routeDistanceSum, int badTelemetryRows, int sampleCount) {
        String render() {
            StringBuilder text = new StringBuilder();
            text.append("=== Orbital mission control ===\n");
            text.append("scenario missions=").append(config.size()).append(" seed=").append(config.seed())
                    .append(" tickLimit=").append(config.ticks()).append('\n');
            EnumMap<Status, Integer> counts = new EnumMap<>(Status.class);
            for (Mission mission : scheduler.missions.values()) {
                counts.merge(mission.status, 1, Integer::sum);
            }
            String statuses = counts.entrySet().stream()
                    .map(entry -> entry.getKey() + "=" + entry.getValue())
                    .collect(Collectors.joining(" "));
            text.append("status ").append(statuses.isEmpty() ? "-" : statuses).append('\n');
            text.append("fuel initial=").append(scheduler.ledger.initial)
                    .append(" available=").append(scheduler.ledger.available)
                    .append(" reserved=").append(scheduler.ledger.reserved)
                    .append(" spent=").append(scheduler.ledger.spent).append('\n');
            text.append("slots peak=").append(scheduler.slots.highWater)
                    .append(" capacity=").append(scheduler.slots.capacity)
                    .append(" active=").append(scheduler.slots.owners.size()).append('\n');
            text.append("scheduler ticks=").append(scheduler.ticks)
                    .append(" attempts=").append(scheduler.planningAttempts)
                    .append(" deferred=").append(scheduler.deferred)
                    .append(" criticalPath=").append(criticalPath).append('\n');
            text.append("network stations=").append(scheduler.network.size())
                    .append(" components=").append(components)
                    .append(" distanceSum=").append(routeDistanceSum).append('\n');
            text.append("telemetry samples=").append(sampleCount)
                    .append(" badRows=").append(badTelemetryRows)
                    .append(" lowStreak=").append(longestStreak).append('\n');
            text.append("faults ");
            if (scheduler.journal.faults.isEmpty()) {
                text.append('-');
            } else {
                text.append(scheduler.journal.faults.entrySet().stream()
                        .map(entry -> entry.getKey() + "=" + entry.getValue())
                        .collect(Collectors.joining(",")));
            }
            text.append('\n');
            text.append("events=").append(scheduler.journal.events.size())
                    .append(" replayHash=").append(Long.toUnsignedString(scheduler.journal.hash)).append('\n');
            text.append("algorithms");
            for (long result : algorithms) {
                text.append(' ').append(result);
            }
            text.append('\n');
            text.append("cleanup=").append(String.join("|", cleanupTrace(true, true))).append('\n');
            text.append("labeled=").append(labeledWalk(new int[][]{{1, 2}, {3, -1, 9}, {4, 99, 8}})).append('\n');
            text.append("pattern=").append(classifyObject(new Coordinate(2, 7))).append('\n');
            long checksum = 2166136261L;
            for (int index = 0; index < text.length(); index++) {
                checksum = ((checksum ^ text.charAt(index)) * 16777619L) & 0xffffffffL;
            }
            return text.append("checksum=").append(checksum).append('\n').toString();
        }
    }
}
