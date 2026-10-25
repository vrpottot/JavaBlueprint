import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.PriorityQueue;
import java.util.Queue;
import java.util.Scanner;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.function.Predicate;
import java.util.stream.Collectors;

/** Bounded single-threaded transit simulation, using logical ticks rather than time APIs. */
public final class TransitGrid {
    static final long INF = Long.MAX_VALUE / 4;

    private TransitGrid() {
    }

    enum Rider {
        ADULT, STUDENT, CHILD;

        int percent() {
            return switch (this) {
                case ADULT -> 100;
                case STUDENT -> 70;
                case CHILD -> 40;
            };
        }
    }

    enum BookingState {
        REQUESTED, CONFIRMED, REJECTED, CANCELLED;
    }

    record Station(int id, String name, int zone) {
        Station {
            if (id < 0 || name.isBlank() || zone < 0) {
                throw new IllegalArgumentException("station");
            }
        }
    }

    static class Link {
        final int id;
        final int from;
        final int to;
        final int minutes;
        final int capacity;
        final int interval;
        int reserved;
        boolean closed;

        Link(int id, int from, int to, int minutes, int capacity, int interval) {
            if (id < 0 || from < 0 || to < 0 || from == to || minutes <= 0 || capacity < 0 || interval <= 0) {
                throw new IllegalArgumentException("link");
            }
            this.id = id;
            this.from = from;
            this.to = to;
            this.minutes = minutes;
            this.capacity = capacity;
            this.interval = interval;
        }

        int available() {
            return closed ? 0 : capacity - reserved;
        }

        long departure(long tick) {
            long remainder = Math.floorMod(tick, interval);
            return remainder == 0 ? tick : Math.addExact(tick, interval - remainder);
        }

        long travel(long tick) {
            return Math.addExact(departure(tick), minutes);
        }

        void reserve(int count) {
            if (count <= 0 || count > available()) {
                throw new IllegalStateException("capacity");
            }
            reserved += count;
        }

        void release(int count) {
            if (count <= 0 || count > reserved) {
                throw new IllegalStateException("release");
            }
            reserved -= count;
        }
    }

    static final class ExpressLink extends Link {
        final int boarding;

        ExpressLink(int id, int from, int to, int minutes, int capacity, int boarding) {
            super(id, from, to, minutes, capacity, 1);
            if (boarding < 0) {
                throw new IllegalArgumentException("boarding");
            }
            this.boarding = boarding;
        }

        @Override
        long travel(long tick) {
            return Math.addExact(super.travel(tick), boarding);
        }
    }

    static final class Network implements Iterable<Station> {
        final List<Station> stations = new ArrayList<>();
        final List<List<Link>> outgoing = new ArrayList<>();
        final Map<Integer, Link> links = new LinkedHashMap<>();

        Station add(String name, int zone) {
            Station station = new Station(stations.size(), name, zone);
            stations.add(station);
            outgoing.add(new ArrayList<>());
            return station;
        }

        void connect(Link link) {
            check(link.from);
            check(link.to);
            if (links.putIfAbsent(link.id, link) != null) {
                throw new IllegalArgumentException("duplicate link");
            }
            outgoing.get(link.from).add(link);
        }

        void check(int station) {
            if (station < 0 || station >= size()) {
                throw new IllegalArgumentException("unknown station " + station);
            }
        }

        int size() {
            return stations.size();
        }

        Optional<Link> link(int id) {
            return Optional.ofNullable(links.get(id));
        }

        List<Integer> reachable(int source) {
            check(source);
            boolean[] seen = new boolean[size()];
            Deque<Integer> queue = new ArrayDeque<>();
            List<Integer> result = new ArrayList<>();
            seen[source] = true;
            queue.add(source);
            while (!queue.isEmpty()) {
                int current = queue.removeFirst();
                result.add(current);
                for (Link edge : outgoing.get(current)) {
                    if (!edge.closed && !seen[edge.to]) {
                        seen[edge.to] = true;
                        queue.addLast(edge.to);
                    }
                }
            }
            return result;
        }

        @Override
        public Iterator<Station> iterator() {
            return Collections.unmodifiableList(stations).iterator();
        }
    }

    record State(int vertex, long distance) {
    }

    record Path(long arrival, List<Integer> links) {
        Path {
            links = List.copyOf(links);
        }

        boolean found() {
            return arrival < INF;
        }
    }

    static final class Router {
        final Network network;

        Router(Network network) {
            this.network = network;
        }

        Path route(int source, int destination, long start, int seats, boolean timetable) {
            network.check(source);
            network.check(destination);
            if (seats <= 0 || start < 0 || start > 1_000_000_000L) {
                throw new IllegalArgumentException("route request");
            }
            long[] distance = new long[network.size()];
            Arrays.fill(distance, INF);
            int[] previous = new int[network.size()];
            Arrays.fill(previous, -1);
            PriorityQueue<State> queue = new PriorityQueue<>(Comparator.comparingLong(State::distance)
                    .thenComparingInt(State::vertex));
            distance[source] = start;
            queue.add(new State(source, start));
            while (!queue.isEmpty()) {
                State current = queue.remove();
                if (current.distance != distance[current.vertex]) {
                    continue;
                }
                if (current.vertex == destination) {
                    break;
                }
                for (Link edge : network.outgoing.get(current.vertex)) {
                    if (edge.available() < seats) {
                        continue;
                    }
                    long arrival = timetable ? edge.travel(current.distance)
                            : current.distance + edge.minutes + (edge instanceof ExpressLink express ? express.boarding : 0);
                    if (arrival < distance[edge.to]) {
                        distance[edge.to] = arrival;
                        previous[edge.to] = edge.id;
                        queue.add(new State(edge.to, arrival));
                    }
                }
            }
            if (distance[destination] == INF) {
                return new Path(INF, List.of());
            }
            List<Integer> path = new ArrayList<>();
            for (int station = destination; station != source;) {
                Link edge = network.links.get(previous[station]);
                if (edge == null || path.size() >= network.size()) {
                    throw new IllegalStateException("broken predecessor chain");
                }
                path.add(edge.id);
                station = edge.from;
            }
            Collections.reverse(path);
            return new Path(distance[destination], path);
        }

        long[][] floyd() {
            int count = network.size();
            long[][] distance = new long[count][count];
            for (int i = 0; i < count; i++) {
                Arrays.fill(distance[i], INF);
                distance[i][i] = 0;
            }
            for (Link edge : network.links.values()) {
                if (edge.available() > 0) {
                    long cost = edge.minutes + (edge instanceof ExpressLink express ? express.boarding : 0);
                    distance[edge.from][edge.to] = Math.min(distance[edge.from][edge.to], cost);
                }
            }
            for (int via = 0; via < count; via++) {
                for (int from = 0; from < count; from++) {
                    if (distance[from][via] == INF) {
                        continue;
                    }
                    for (int to = 0; to < count; to++) {
                        if (distance[via][to] == INF) {
                            continue;
                        }
                        distance[from][to] = Math.min(distance[from][to], distance[from][via] + distance[via][to]);
                    }
                }
            }
            return distance;
        }
    }

    static final class ResidualEdge {
        final int to;
        final int reverse;
        final long original;
        long capacity;

        ResidualEdge(int to, int reverse, long capacity) {
            this.to = to;
            this.reverse = reverse;
            this.original = capacity;
            this.capacity = capacity;
        }
    }

    static final class Flow {
        final List<List<ResidualEdge>> graph;
        final int[] level;
        final int[] cursor;

        Flow(int vertices) {
            graph = new ArrayList<>();
            for (int i = 0; i < vertices; i++) {
                graph.add(new ArrayList<>());
            }
            level = new int[vertices];
            cursor = new int[vertices];
        }

        void add(int from, int to, long capacity) {
            if (from == to || capacity < 0 || capacity > 1_000_000_000L) {
                throw new IllegalArgumentException("flow edge");
            }
            ResidualEdge forward = new ResidualEdge(to, graph.get(to).size(), capacity);
            ResidualEdge reverse = new ResidualEdge(from, graph.get(from).size(), 0);
            graph.get(from).add(forward);
            graph.get(to).add(reverse);
        }

        boolean levels(int source, int sink) {
            Arrays.fill(level, -1);
            Deque<Integer> queue = new ArrayDeque<>();
            level[source] = 0;
            queue.add(source);
            while (!queue.isEmpty()) {
                int current = queue.removeFirst();
                for (ResidualEdge edge : graph.get(current)) {
                    if (edge.capacity > 0 && level[edge.to] < 0) {
                        level[edge.to] = level[current] + 1;
                        queue.addLast(edge.to);
                    }
                }
            }
            return level[sink] >= 0;
        }

        long push(int vertex, int sink, long maximum) {
            if (vertex == sink) {
                return maximum;
            }
            List<ResidualEdge> edges = graph.get(vertex);
            for (; cursor[vertex] < edges.size(); cursor[vertex]++) {
                ResidualEdge edge = edges.get(cursor[vertex]);
                if (edge.capacity == 0 || level[edge.to] != level[vertex] + 1) {
                    continue;
                }
                long sent = push(edge.to, sink, Math.min(maximum, edge.capacity));
                if (sent > 0) {
                    edge.capacity -= sent;
                    graph.get(edge.to).get(edge.reverse).capacity += sent;
                    return sent;
                }
            }
            return 0;
        }

        long maximum(int source, int sink) {
            if (source == sink) {
                return 0;
            }
            long total = 0;
            while (levels(source, sink)) {
                Arrays.fill(cursor, 0);
                long sent;
                while ((sent = push(source, sink, INF)) > 0) {
                    total = Math.addExact(total, sent);
                }
            }
            return total;
        }

        Set<Integer> reachable(int source) {
            Set<Integer> visited = new TreeSet<>();
            Queue<Integer> queue = new ArrayDeque<>();
            visited.add(source);
            queue.add(source);
            while (!queue.isEmpty()) {
                int vertex = queue.remove();
                for (ResidualEdge edge : graph.get(vertex)) {
                    if (edge.capacity > 0 && visited.add(edge.to)) {
                        queue.add(edge.to);
                    }
                }
            }
            return visited;
        }

        long cutCapacity(Set<Integer> left) {
            long result = 0;
            for (int from : left) {
                for (ResidualEdge edge : graph.get(from)) {
                    if (!left.contains(edge.to)) {
                        result += edge.original;
                    }
                }
            }
            return result;
        }

        static Flow from(Network network) {
            Flow flow = new Flow(network.size());
            for (Link edge : network.links.values()) {
                if (edge.available() > 0) {
                    flow.add(edge.from, edge.to, edge.available());
                }
            }
            return flow;
        }
    }

    static final class Components {
        final Network network;
        final int[] index;
        final int[] low;
        final boolean[] onStack;
        final Deque<Integer> stack = new ArrayDeque<>();
        final List<List<Integer>> groups = new ArrayList<>();
        int next;

        Components(Network network) {
            this.network = network;
            index = new int[network.size()];
            low = new int[network.size()];
            onStack = new boolean[network.size()];
            Arrays.fill(index, -1);
        }

        List<List<Integer>> find() {
            for (int vertex = 0; vertex < network.size(); vertex++) {
                if (index[vertex] < 0) {
                    visit(vertex);
                }
            }
            return groups;
        }

        void visit(int vertex) {
            index[vertex] = next;
            low[vertex] = next++;
            stack.push(vertex);
            onStack[vertex] = true;
            for (Link edge : network.outgoing.get(vertex)) {
                if (edge.closed) {
                    continue;
                }
                if (index[edge.to] < 0) {
                    visit(edge.to);
                    low[vertex] = Math.min(low[vertex], low[edge.to]);
                } else if (onStack[edge.to]) {
                    low[vertex] = Math.min(low[vertex], index[edge.to]);
                }
            }
            if (low[vertex] != index[vertex]) {
                return;
            }
            List<Integer> component = new ArrayList<>();
            int current;
            do {
                current = stack.pop();
                onStack[current] = false;
                component.add(current);
            } while (current != vertex);
            Collections.sort(component);
            groups.add(component);
        }
    }

    static final class DisjointSet {
        final int[] parent;
        final int[] rank;

        DisjointSet(int count) {
            parent = new int[count];
            rank = new int[count];
            for (int i = 0; i < count; i++) {
                parent[i] = i;
            }
        }

        int root(int vertex) {
            int current = vertex;
            while (parent[current] != current) {
                current = parent[current];
            }
            while (parent[vertex] != vertex) {
                int next = parent[vertex];
                parent[vertex] = current;
                vertex = next;
            }
            return current;
        }

        boolean merge(int a, int b) {
            int left = root(a);
            int right = root(b);
            if (left == right) {
                return false;
            }
            if (rank[left] < rank[right]) {
                int temporary = left;
                left = right;
                right = temporary;
            }
            parent[right] = left;
            if (rank[left] == rank[right]) {
                rank[left]++;
            }
            return true;
        }
    }

    record Backbone(long cost, List<Integer> links, int components) {
    }

    static Backbone backbone(Network network) {
        List<Link> edges = new ArrayList<>(network.links.values());
        edges.removeIf(edge -> edge.closed);
        edges.sort(Comparator.comparingInt((Link edge) -> edge.minutes).thenComparingInt(edge -> edge.id));
        DisjointSet set = new DisjointSet(network.size());
        List<Integer> selected = new ArrayList<>();
        long cost = 0;
        int components = network.size();
        for (Link edge : edges) {
            if (set.merge(edge.from, edge.to)) {
                cost += edge.minutes;
                selected.add(edge.id);
                components--;
            }
        }
        return new Backbone(cost, selected, components);
    }

    static final class Fenwick {
        final long[] tree;

        Fenwick(int size) {
            tree = new long[size + 1];
        }

        void add(int at, long delta) {
            if (at < 0 || at >= tree.length - 1) {
                throw new IllegalArgumentException("fenwick index");
            }
            for (int i = at + 1; i < tree.length; i += i & -i) {
                tree[i] += delta;
            }
        }

        long prefix(int end) {
            if (end < 0 || end >= tree.length) {
                throw new IllegalArgumentException("fenwick bound");
            }
            long result = 0;
            for (int i = end; i > 0; i -= i & -i) {
                result += tree[i];
            }
            return result;
        }

        long range(int left, int right) {
            if (left > right) {
                throw new IllegalArgumentException("reversed range");
            }
            return prefix(right) - prefix(left);
        }
    }

    record Interval(int start, int end, int weight) {
        Interval {
            if (start < 0 || start >= end || weight <= 0) {
                throw new IllegalArgumentException("interval");
            }
        }
    }

    static int peak(List<Interval> intervals) {
        TreeMap<Integer, Integer> changes = new TreeMap<>();
        for (Interval interval : intervals) {
            changes.merge(interval.start, interval.weight, Integer::sum);
            changes.merge(interval.end, -interval.weight, Integer::sum);
        }
        int current = 0;
        int maximum = 0;
        for (int delta : changes.values()) {
            current += delta;
            maximum = Math.max(maximum, current);
        }
        return maximum;
    }

    static long fare(Network network, Path path, Rider rider, int passengers) {
        if (!path.found() || passengers <= 0) {
            throw new IllegalArgumentException("fare request");
        }
        if (path.links.isEmpty()) {
            return 0;
        }
        Set<Integer> zones = new HashSet<>();
        long distance = 0;
        for (int id : path.links) {
            Link edge = network.links.get(id);
            zones.add(network.stations.get(edge.from).zone);
            zones.add(network.stations.get(edge.to).zone);
            distance += edge.minutes;
        }
        long base = 100 + 25L * zones.size() + 3 * distance;
        return Math.multiplyExact((base * rider.percent() + 99) / 100, passengers);
    }

    static final class Booking {
        final int id;
        final int source;
        final int destination;
        final int passengers;
        final Rider rider;
        BookingState state = BookingState.REQUESTED;
        Path path = new Path(INF, List.of());
        long price;

        Booking(int id, int source, int destination, int passengers, Rider rider) {
            if (passengers <= 0) {
                throw new IllegalArgumentException("passengers");
            }
            this.id = id;
            this.source = source;
            this.destination = destination;
            this.passengers = passengers;
            this.rider = Objects.requireNonNull(rider);
        }
    }

    static final class Reservation implements AutoCloseable {
        final List<Link> reserved = new ArrayList<>();
        final int passengers;
        boolean committed;

        Reservation(int passengers) {
            this.passengers = passengers;
        }

        void add(Link link) {
            link.reserve(passengers);
            reserved.add(link);
        }

        void commit() {
            committed = true;
        }

        @Override
        public void close() {
            if (!committed) {
                for (int i = reserved.size() - 1; i >= 0; i--) {
                    reserved.get(i).release(passengers);
                }
            }
        }
    }

    static final class BookingEngine {
        final Network network;
        final Router router;
        final Map<Integer, Booking> bookings = new LinkedHashMap<>();
        final List<String> trace = new LinkedList<>();
        long revenue;

        BookingEngine(Network network) {
            this.network = network;
            router = new Router(network);
        }

        boolean book(Booking booking, long tick, boolean inject) {
            if (bookings.putIfAbsent(booking.id, booking) != null) {
                return false;
            }
            try {
                Path path = router.route(booking.source, booking.destination, tick, booking.passengers, true);
                if (!path.found()) {
                    booking.state = BookingState.REJECTED;
                    return false;
                }
                long price = fare(network, path, booking.rider, booking.passengers);
                try (Reservation reservation = new Reservation(booking.passengers)) {
                    for (int id : path.links) {
                        reservation.add(network.links.get(id));
                        if (inject) {
                            throw new IllegalStateException("injected reservation failure");
                        }
                    }
                    long total = Math.addExact(revenue, price);
                    booking.path = path;
                    booking.price = price;
                    booking.state = BookingState.CONFIRMED;
                    revenue = total;
                    reservation.commit();
                }
                return true;
            } catch (IllegalArgumentException | IllegalStateException failure) {
                booking.state = BookingState.REJECTED;
                trace.add("rejected:" + booking.id);
                return false;
            } finally {
                trace.add("attempt:" + booking.id);
            }
        }

        boolean cancel(int id) {
            Booking booking = bookings.get(id);
            if (booking == null || booking.state != BookingState.CONFIRMED) {
                return false;
            }
            for (int edge : booking.path.links) {
                network.links.get(edge).release(booking.passengers);
            }
            revenue -= booking.price;
            booking.state = BookingState.CANCELLED;
            trace.add("cancelled:" + id);
            return true;
        }

        void check() {
            Map<Integer, Integer> expected = new HashMap<>();
            long total = 0;
            for (Booking booking : bookings.values()) {
                if (booking.state == BookingState.CONFIRMED) {
                    total += booking.price;
                    for (int id : booking.path.links) {
                        expected.merge(id, booking.passengers, Integer::sum);
                    }
                }
                if (booking.state == BookingState.REQUESTED) {
                    throw new IllegalStateException("unfinished booking");
                }
            }
            for (Link edge : network.links.values()) {
                if (edge.reserved != expected.getOrDefault(edge.id, 0) || edge.reserved < 0 || edge.reserved > edge.capacity) {
                    throw new IllegalStateException("reservation invariant");
                }
            }
            if (total != revenue) {
                throw new IllegalStateException("revenue invariant");
            }
        }

        Map<BookingState, Integer> counts() {
            Map<BookingState, Integer> result = new EnumMap<>(BookingState.class);
            for (Booking booking : bookings.values()) {
                result.merge(booking.state, 1, Integer::sum);
            }
            return result;
        }
    }

    static List<Integer> transferPlan(Network network, int source, int target, Set<Integer> forbidden) {
        List<Integer> result = new ArrayList<>();
        List<Integer> starts = network.reachable(source);
        search:
        for (int middle : starts) {
            if (forbidden.contains(middle)) {
                continue;
            }
            for (Link edge : network.outgoing.get(middle)) {
                if (edge.closed) {
                    continue;
                }
                for (int next : network.reachable(edge.to)) {
                    if (next == target) {
                        result.add(middle);
                        result.add(edge.to);
                        break search;
                    }
                }
            }
        }
        return result;
    }

    static List<Integer> topological(Network network) {
        int[] degree = new int[network.size()];
        for (Link edge : network.links.values()) {
            if (!edge.closed) {
                degree[edge.to]++;
            }
        }
        PriorityQueue<Integer> ready = new PriorityQueue<>();
        for (int vertex = 0; vertex < degree.length; vertex++) {
            if (degree[vertex] == 0) {
                ready.add(vertex);
            }
        }
        List<Integer> result = new ArrayList<>();
        while (!ready.isEmpty()) {
            int vertex = ready.remove();
            result.add(vertex);
            for (Link edge : network.outgoing.get(vertex)) {
                if (!edge.closed && --degree[edge.to] == 0) {
                    ready.add(edge.to);
                }
            }
        }
        if (result.size() != network.size()) {
            throw new IllegalArgumentException("cyclic network");
        }
        return result;
    }

    static Network condensation(Network network) {
        List<List<Integer>> groups = new Components(network).find();
        int[] component = new int[network.size()];
        Network condensed = new Network();
        for (int i = 0; i < groups.size(); i++) {
            condensed.add("component-" + i, 0);
            for (int vertex : groups.get(i)) {
                component[vertex] = i;
            }
        }
        Set<String> connected = new HashSet<>();
        int id = 0;
        for (Link edge : network.links.values()) {
            int from = component[edge.from];
            int to = component[edge.to];
            if (!edge.closed && from != to && connected.add(from + ":" + to)) {
                condensed.connect(new Link(id++, from, to, 1, 1, 1));
            }
        }
        return condensed;
    }

    static int[] apportion(int seats, int[] requests) {
        if (seats < 0) {
            throw new IllegalArgumentException("negative seats");
        }
        long total = 0;
        for (int request : requests) {
            if (request < 0) {
                throw new IllegalArgumentException("negative request");
            }
            total += request;
        }
        int[] result = new int[requests.length];
        if (total == 0 || seats == 0) {
            return result;
        }
        if (total <= seats) {
            return requests.clone();
        }
        long[] remainders = new long[requests.length];
        int remaining = seats;
        List<Integer> priority = new ArrayList<>();
        for (int i = 0; i < requests.length; i++) {
            long weighted = (long) seats * requests[i];
            result[i] = (int) (weighted / total);
            remainders[i] = weighted % total;
            remaining -= result[i];
            priority.add(i);
        }
        priority.sort(Comparator.comparingLong((Integer index) -> remainders[index]).reversed()
                .thenComparingInt(Integer::intValue));
        for (int index : priority) {
            if (remaining == 0) {
                break;
            }
            if (result[index] < requests[index]) {
                result[index]++;
                remaining--;
            }
        }
        if (remaining != 0) {
            throw new IllegalStateException("apportionment remainder");
        }
        return result;
    }

    static Network generate(int size, long seed) {
        Network network = new Network();
        for (int i = 0; i < size; i++) {
            network.add("Станция-" + i, i % 4);
        }
        long state = seed;
        int id = 0;
        for (int from = 0; from < size; from++) {
            for (int to = 0; to < size; to++) {
                if (from == to) {
                    continue;
                }
                state = state * 6364136223846793005L + 1;
                if (to != (from + 1) % size && Long.remainderUnsigned(state, 7) != 0) {
                    continue;
                }
                int minutes = 1 + (int) Long.remainderUnsigned(state >>> 7, 20);
                int capacity = 2 + (int) Long.remainderUnsigned(state >>> 13, 13);
                Link link = id % 5 == 0 ? new ExpressLink(id, from, to, minutes, capacity, 2)
                        : new Link(id, from, to, minutes, capacity, 1 + id % 4);
                if (id % 17 == 6) {
                    link.closed = true;
                }
                network.connect(link);
                id++;
            }
        }
        return network;
    }

    static String describe(Object value) {
        return switch (value) {
            case Station(int id, String name, int zone) -> name + "#" + id + "/" + zone;
            case Path(long arrival, List<Integer> edges) when arrival < INF -> "path:" + arrival + "/" + edges.size();
            case Path ignored -> "unreachable";
            case null -> "null";
            default -> value.toString();
        };
    }

    static long checksum(String text) {
        long result = 0x811c9dc5L;
        for (int i = 0; i < text.length(); i++) {
            result = ((result ^ text.charAt(i)) * 16777619L) & 0xffffffffL;
        }
        return result;
    }

    static String run(int count, long seed, boolean disrupt) {
        int size = Math.max(0, Math.min(48, count));
        Network network = generate(size, seed);
        BookingEngine engine = new BookingEngine(network);
        long flowValue = 0;
        long cutValue = 0;
        long shortestSum = 0;
        if (size > 1) {
            Flow flow = Flow.from(network);
            flowValue = flow.maximum(0, size - 1);
            cutValue = flow.cutCapacity(flow.reachable(0));
            long[][] distances = new Router(network).floyd();
            for (long[] row : distances) {
                for (long distance : row) {
                    if (distance < INF) {
                        shortestSum += distance;
                    }
                }
            }
        }
        List<Interval> intervals = new ArrayList<>();
        for (int i = 0; i < size * 3; i++) {
            int from = i % size;
            int to = (from + 1 + i % Math.max(1, size - 1)) % size;
            Booking booking = new Booking(i, from, to, 1 + i % 3, Rider.values()[i % 3]);
            if (disrupt && i % 7 == 0 && !network.links.isEmpty()) {
                network.links.values().iterator().next().closed = true;
            }
            if (engine.book(booking, i, disrupt && i % 11 == 2)) {
                int end = (int) booking.path.arrival;
                if (end > i) {
                    intervals.add(new Interval(i, end, booking.passengers));
                }
                if (i % 5 == 0) {
                    engine.cancel(i);
                }
            }
        }
        engine.check();
        Backbone backbone = backbone(network);
        List<List<Integer>> groups = new Components(network).find();
        Fenwick reservations = new Fenwick(network.links.size());
        for (Link link : network.links.values()) {
            reservations.add(link.id, link.reserved);
        }
        StringBuilder text = new StringBuilder("=== Transit grid / Транспорт ===\n");
        text.append("stations=").append(size).append(" seed=").append(seed).append('\n');
        text.append("links=").append(network.links.size()).append(" scc=").append(groups.size()).append('\n');
        text.append("flow=").append(flowValue).append(" cut=").append(cutValue).append(" shortest=").append(shortestSum).append('\n');
        text.append("backbone=").append(backbone.cost).append('/').append(backbone.components).append('\n');
        text.append("bookings=").append(engine.counts()).append(" revenue=").append(engine.revenue).append('\n');
        text.append("peak=").append(peak(intervals)).append(" seats=").append(reservations.prefix(network.links.size())).append('\n');
        int[] allocation = apportion(12, new int[]{size, size / 2, size / 3});
        text.append("allocation=").append(Arrays.toString(allocation)).append('\n');
        if (size > 0) {
            text.append("first=").append(describe(network.stations.get(0))).append('\n');
            text.append("transfer=").append(transferPlan(network, 0, size - 1, Set.of())).append('\n');
        }
        text.append("checksum=").append(checksum(text.toString())).append('\n');
        return text.toString();
    }

    public static void main(String[] args) throws IOException {
        String text = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
        try (Scanner scanner = new Scanner(text)) {
            int size = scanner.hasNextInt() ? scanner.nextInt() : 18;
            long seed = scanner.hasNextLong() ? scanner.nextLong() : 31;
            boolean disrupt = scanner.hasNextInt() && scanner.nextInt() != 0;
            System.out.printf(Locale.ROOT, "%s", run(size, seed, disrupt));
        }
    }
}
