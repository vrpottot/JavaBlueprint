import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Formatter;
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
import java.util.Scanner;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Collectors;

/** Fictional, deterministic clearing simulation. No external systems or real rates. */
public final class ClearingHouse {
    private ClearingHouse() {
    }

    enum Currency {
        USD, EUR, KZT;

        static Currency parse(String text) {
            return valueOf(text.strip().toUpperCase(Locale.ROOT));
        }
    }

    enum Tier {
        STANDARD, SILVER, GOLD;

        int discountBasisPoints() {
            return switch (this) {
                case STANDARD -> 0;
                case SILVER -> 2500;
                case GOLD -> 5000;
            };
        }
    }

    enum Status {
        NEW, HELD, POSTED, REJECTED, REVERSED;

        boolean terminal() {
            return this == POSTED || this == REJECTED || this == REVERSED;
        }
    }

    enum Failure {
        UNKNOWN_ACCOUNT, INSUFFICIENT_FUNDS, INVALID_AMOUNT, FROZEN,
        DUPLICATE, LIMIT, DEPENDENCY, CURRENCY, INVALID_STATE;
    }

    static final class ClearingException extends Exception {
        private static final long serialVersionUID = 1L;
        final Failure reason;

        ClearingException(Failure reason, String message) {
            super(message);
            this.reason = reason;
        }
    }

    record Money(Currency currency, long cents) {
        Money {
            Objects.requireNonNull(currency);
        }

        Money plus(Money other) {
            if (currency != other.currency) {
                throw new IllegalArgumentException("currency mismatch");
            }
            return new Money(currency, Math.addExact(cents, other.cents));
        }

        Money negate() {
            return new Money(currency, Math.negateExact(cents));
        }

        String format() {
            long whole = cents / 100;
            long fraction = Math.abs(cents % 100);
            String sign = cents < 0 && whole == 0 ? "-" : "";
            return String.format(Locale.ROOT, "%s%d.%02d %s", sign, whole, fraction, currency);
        }
    }

    record Rate(Currency from, Currency to, long numerator, long denominator) {
        Rate {
            if (from == to || numerator <= 0 || denominator <= 0) {
                throw new IllegalArgumentException("invalid rate");
            }
        }

        Money convert(Money input) {
            if (input.currency != from || input.cents < 0) {
                throw new IllegalArgumentException("invalid conversion");
            }
            long scaled = Math.multiplyExact(input.cents, numerator);
            return new Money(to, scaled / denominator);
        }

        Rate inverse() {
            return new Rate(to, from, denominator, numerator);
        }
    }

    static final class RateBook {
        final Map<Currency, Map<Currency, Rate>> rates = new EnumMap<>(Currency.class);

        void put(Rate rate) {
            rates.computeIfAbsent(rate.from, ignored -> new EnumMap<>(Currency.class)).put(rate.to, rate);
            Rate inverse = rate.inverse();
            rates.computeIfAbsent(inverse.from, ignored -> new EnumMap<>(Currency.class)).put(inverse.to, inverse);
        }

        List<Rate> route(Currency from, Currency to) {
            Deque<Currency> queue = new ArrayDeque<>();
            Map<Currency, Rate> previous = new EnumMap<>(Currency.class);
            Set<Currency> visited = EnumSet.of(from);
            queue.add(from);
            while (!queue.isEmpty()) {
                Currency current = queue.removeFirst();
                if (current == to) {
                    break;
                }
                for (Rate rate : rates.getOrDefault(current, Map.of()).values()) {
                    if (visited.add(rate.to)) {
                        previous.put(rate.to, rate);
                        queue.addLast(rate.to);
                    }
                }
            }
            if (!visited.contains(to)) {
                throw new IllegalArgumentException("no currency path");
            }
            List<Rate> result = new ArrayList<>();
            for (Currency current = to; current != from;) {
                Rate step = previous.get(current);
                result.add(step);
                current = step.from;
            }
            Collections.reverse(result);
            return result;
        }

        Money convert(Money amount, Currency target) {
            Money result = amount;
            for (Rate rate : route(amount.currency, target)) {
                result = rate.convert(result);
            }
            return result;
        }
    }

    interface Identified {
        String id();
    }

    static class Account implements Identified {
        final String id;
        final Currency currency;
        final Tier tier;
        long balance;
        boolean frozen;
        final Map<String, Long> holds = new LinkedHashMap<>();

        Account(String id, Currency currency, Tier tier, long opening) {
            if (id.isBlank() || opening < 0) {
                throw new IllegalArgumentException("invalid account");
            }
            this.id = id;
            this.currency = currency;
            this.tier = tier;
            this.balance = opening;
        }

        @Override
        public String id() {
            return id;
        }

        long held() {
            long sum = 0;
            for (long value : holds.values()) {
                sum = Math.addExact(sum, value);
            }
            return sum;
        }

        long available() {
            return balance - held();
        }

        long limit() {
            return switch (tier) {
                case STANDARD -> 100_000;
                case SILVER -> 300_000;
                case GOLD -> 1_000_000;
            };
        }

        void reserve(String reference, long amount) throws ClearingException {
            if (frozen) {
                throw new ClearingException(Failure.FROZEN, id);
            }
            if (amount <= 0) {
                throw new ClearingException(Failure.INVALID_AMOUNT, "nonpositive hold");
            }
            if (holds.containsKey(reference)) {
                throw new ClearingException(Failure.DUPLICATE, reference);
            }
            if (amount > available()) {
                throw new ClearingException(Failure.INSUFFICIENT_FUNDS, id);
            }
            holds.put(reference, amount);
        }

        long release(String reference) {
            Long value = holds.remove(reference);
            return value == null ? 0 : value;
        }

        void capture(String reference) throws ClearingException {
            Long amount = holds.get(reference);
            if (amount == null) {
                throw new ClearingException(Failure.INVALID_STATE, "missing hold");
            }
            balance = Math.subtractExact(balance, amount);
            holds.remove(reference);
        }

        void credit(long amount) {
            if (amount < 0) {
                throw new IllegalArgumentException("negative credit");
            }
            balance = Math.addExact(balance, amount);
        }

        Snapshot snapshot() {
            return new Snapshot(balance, frozen, new LinkedHashMap<>(holds));
        }

        void restore(Snapshot snapshot) {
            balance = snapshot.balance;
            frozen = snapshot.frozen;
            holds.clear();
            holds.putAll(snapshot.holds);
        }
    }

    static final class BusinessAccount extends Account {
        final long transferLimit;

        BusinessAccount(String id, Currency currency, long opening, long transferLimit) {
            super(id, currency, Tier.GOLD, opening);
            if (transferLimit <= 0) {
                throw new IllegalArgumentException("business limit");
            }
            this.transferLimit = transferLimit;
        }

        @Override
        long limit() {
            return transferLimit;
        }
    }

    record Snapshot(long balance, boolean frozen, Map<String, Long> holds) {
    }

    static final class Repository<T extends Identified> implements Iterable<T> {
        final Map<String, T> data = new LinkedHashMap<>();

        void add(T value) {
            if (data.putIfAbsent(value.id(), value) != null) {
                throw new IllegalArgumentException("duplicate id " + value.id());
            }
        }

        Optional<T> find(String id) {
            return Optional.ofNullable(data.get(id));
        }

        T require(String id) throws ClearingException {
            T result = data.get(id);
            if (result == null) {
                throw new ClearingException(Failure.UNKNOWN_ACCOUNT, id);
            }
            return result;
        }

        List<T> matching(Predicate<T> predicate) {
            List<T> result = new ArrayList<>();
            for (T item : data.values()) {
                if (predicate.test(item)) {
                    result.add(item);
                }
            }
            return result;
        }

        <R> List<R> project(Function<T, R> mapper) {
            List<R> result = new ArrayList<>();
            for (T item : this) {
                result.add(mapper.apply(item));
            }
            return result;
        }

        int size() {
            return data.size();
        }

        @Override
        public Iterator<T> iterator() {
            return Collections.unmodifiableCollection(data.values()).iterator();
        }
    }

    static final class Payment implements Identified {
        final String reference;
        final String from;
        final String to;
        final Money amount;
        final List<String> dependencies;
        Status status = Status.NEW;
        Failure failure;
        long fee;

        Payment(String reference, String from, String to, Money amount, List<String> dependencies) {
            this.reference = Objects.requireNonNull(reference);
            this.from = Objects.requireNonNull(from);
            this.to = Objects.requireNonNull(to);
            this.amount = Objects.requireNonNull(amount);
            this.dependencies = List.copyOf(dependencies);
        }

        @Override
        public String id() {
            return reference;
        }

        void transition(Status expected, Status next) throws ClearingException {
            if (status != expected) {
                throw new ClearingException(Failure.INVALID_STATE, reference + ":" + status);
            }
            status = next;
        }
    }

    record Entry(String reference, String account, Currency currency, long delta) {
    }

    static final class Journal {
        final List<Entry> entries = new ArrayList<>();
        final List<String> events = new LinkedList<>();

        void append(String reference, Account account, long delta) {
            entries.add(new Entry(reference, account.id, account.currency, delta));
        }

        void event(String text) {
            events.add(text);
        }

        long sum(Currency currency) {
            long result = 0;
            for (Entry entry : entries) {
                if (entry.currency == currency) {
                    result = Math.addExact(result, entry.delta);
                }
            }
            return result;
        }

        Map<String, Long> byAccount() {
            Map<String, Long> result = new TreeMap<>();
            for (Entry entry : entries) {
                result.merge(entry.account, entry.delta, Math::addExact);
            }
            return result;
        }

        List<Entry> statement(String account) {
            return entries.stream().filter(entry -> entry.account.equals(account)).toList();
        }

        void truncate(int size) {
            while (entries.size() > size) {
                entries.remove(entries.size() - 1);
            }
        }
    }

    static final class AtomicPosting implements AutoCloseable {
        final List<Account> accounts;
        final List<Snapshot> before = new ArrayList<>();
        final Journal journal;
        final int journalSize;
        boolean committed;

        AtomicPosting(Collection<Account> accounts, Journal journal) {
            this.accounts = new ArrayList<>(new java.util.LinkedHashSet<>(accounts));
            this.journal = journal;
            this.journalSize = journal.entries.size();
            for (Account account : this.accounts) {
                before.add(account.snapshot());
            }
        }

        void commit() {
            committed = true;
        }

        @Override
        public void close() {
            if (!committed) {
                for (int i = accounts.size() - 1; i >= 0; i--) {
                    accounts.get(i).restore(before.get(i));
                }
                journal.truncate(journalSize);
            }
        }
    }

    static final class FeePolicy {
        long fee(long amount, Tier tier) {
            if (amount <= 0) {
                throw new IllegalArgumentException("fee amount");
            }
            long base = Math.max(5, Math.min(500, (amount + 199) / 200));
            return Math.max(1, base * (10_000 - tier.discountBasisPoints()) / 10_000);
        }

        long total(long amount, Tier tier) {
            return Math.addExact(amount, fee(amount, tier));
        }
    }

    record Attempt(int tick, long amount) {
    }

    static final class RiskWindow {
        final int width;
        final long maximum;
        final Map<String, Deque<Attempt>> windows = new HashMap<>();

        RiskWindow(int width, long maximum) {
            if (width <= 0 || maximum <= 0) {
                throw new IllegalArgumentException("risk limits");
            }
            this.width = width;
            this.maximum = maximum;
        }

        boolean accept(String account, int tick, long amount) {
            Deque<Attempt> queue = windows.computeIfAbsent(account, ignored -> new ArrayDeque<>());
            while (!queue.isEmpty() && queue.peekFirst().tick <= tick - width) {
                queue.removeFirst();
            }
            long sum = 0;
            for (Attempt attempt : queue) {
                sum += attempt.amount;
            }
            if (amount <= 0 || amount > maximum - sum) {
                return false;
            }
            queue.addLast(new Attempt(tick, amount));
            return true;
        }

        void clear(String account) {
            windows.remove(account);
        }
    }

    record Transfer(String debtor, String creditor, long amount) {
        Transfer {
            if (amount <= 0 || debtor.equals(creditor)) {
                throw new IllegalArgumentException("invalid settlement");
            }
        }
    }

    static final class Settlement {
        static Map<String, Long> net(List<Transfer> transfers) {
            Map<String, Long> balances = new TreeMap<>();
            for (Transfer transfer : transfers) {
                balances.merge(transfer.debtor, -transfer.amount, Math::addExact);
                balances.merge(transfer.creditor, transfer.amount, Math::addExact);
            }
            return balances;
        }

        static List<Transfer> compress(List<Transfer> transfers) {
            Map<String, Long> net = net(transfers);
            List<Map.Entry<String, Long>> debtors = new ArrayList<>();
            List<Map.Entry<String, Long>> creditors = new ArrayList<>();
            for (Map.Entry<String, Long> entry : net.entrySet()) {
                if (entry.getValue() < 0) {
                    debtors.add(Map.entry(entry.getKey(), -entry.getValue()));
                } else if (entry.getValue() > 0) {
                    creditors.add(Map.entry(entry.getKey(), entry.getValue()));
                }
            }
            List<Transfer> result = new ArrayList<>();
            int left = 0;
            int right = 0;
            long debt = 0;
            long credit = 0;
            while (left < debtors.size() && right < creditors.size()) {
                if (debt == 0) {
                    debt = debtors.get(left).getValue();
                }
                if (credit == 0) {
                    credit = creditors.get(right).getValue();
                }
                long value = Math.min(debt, credit);
                result.add(new Transfer(debtors.get(left).getKey(), creditors.get(right).getKey(), value));
                debt -= value;
                credit -= value;
                if (debt == 0) {
                    left++;
                }
                if (credit == 0) {
                    right++;
                }
            }
            return result;
        }
    }

    static final class DependencyPlan {
        static List<Payment> order(Repository<Payment> payments) throws ClearingException {
            Map<String, Integer> state = new HashMap<>();
            List<Payment> result = new ArrayList<>();
            for (Payment payment : payments) {
                visit(payment, payments, state, result);
            }
            return result;
        }

        static void visit(Payment payment, Repository<Payment> payments,
                          Map<String, Integer> state, List<Payment> result) throws ClearingException {
            int color = state.getOrDefault(payment.id(), 0);
            if (color == 2) {
                return;
            }
            if (color == 1) {
                throw new ClearingException(Failure.DEPENDENCY, "cycle " + payment.id());
            }
            state.put(payment.id(), 1);
            for (String dependency : payment.dependencies) {
                Payment previous = payments.find(dependency).orElse(null);
                if (previous == null) {
                    throw new ClearingException(Failure.DEPENDENCY, "missing " + dependency);
                }
                visit(previous, payments, state, result);
            }
            state.put(payment.id(), 2);
            result.add(payment);
        }
    }

    static final class ClearingEngine {
        final Repository<Account> accounts = new Repository<>();
        final Repository<Payment> payments = new Repository<>();
        final Journal journal = new Journal();
        final FeePolicy fees = new FeePolicy();
        final RiskWindow risk = new RiskWindow(7, 350_000);
        final EnumMap<Currency, Long> opening = new EnumMap<>(Currency.class);
        int tick;
        int rollbacks;

        void addAccount(Account account) {
            accounts.add(account);
            opening.merge(account.currency, account.balance, Math::addExact);
        }

        Account treasury(Currency currency) throws ClearingException {
            return accounts.require("fees:" + currency);
        }

        void validate(Payment payment, Account source, Account target) throws ClearingException {
            if (payment.amount.cents <= 0 || payment.from.equals(payment.to)) {
                throw new ClearingException(Failure.INVALID_AMOUNT, payment.reference);
            }
            if (source.currency != target.currency || source.currency != payment.amount.currency) {
                throw new ClearingException(Failure.CURRENCY, payment.reference);
            }
            if (payment.amount.cents > source.limit()) {
                throw new ClearingException(Failure.LIMIT, payment.reference);
            }
            if (target.frozen) {
                throw new ClearingException(Failure.FROZEN, target.id);
            }
            for (String dependency : payment.dependencies) {
                if (payments.require(dependency).status != Status.POSTED) {
                    throw new ClearingException(Failure.DEPENDENCY, dependency);
                }
            }
        }

        boolean submit(Payment payment, boolean failAfterDebit) {
            if (payments.find(payment.id()).isPresent()) {
                journal.event("duplicate:" + payment.id());
                return false;
            }
            payments.add(payment);
            tick++;
            try {
                Account source = accounts.require(payment.from);
                Account target = accounts.require(payment.to);
                Account feeAccount = treasury(payment.amount.currency);
                validate(payment, source, target);
                if (!risk.accept(source.id, tick, payment.amount.cents)) {
                    throw new ClearingException(Failure.LIMIT, "velocity");
                }
                payment.fee = fees.fee(payment.amount.cents, source.tier);
                long debit = Math.addExact(payment.amount.cents, payment.fee);
                try (AtomicPosting transaction = new AtomicPosting(List.of(source, target, feeAccount), journal)) {
                    source.reserve(payment.id(), debit);
                    payment.transition(Status.NEW, Status.HELD);
                    source.capture(payment.id());
                    journal.append(payment.id(), source, -debit);
                    if (failAfterDebit) {
                        throw new ClearingException(Failure.INVALID_STATE, "injected failure");
                    }
                    target.credit(payment.amount.cents);
                    feeAccount.credit(payment.fee);
                    journal.append(payment.id(), target, payment.amount.cents);
                    journal.append(payment.id(), feeAccount, payment.fee);
                    payment.transition(Status.HELD, Status.POSTED);
                    transaction.commit();
                } catch (ClearingException failure) {
                    rollbacks++;
                    throw failure;
                } finally {
                    source.release(payment.id());
                }
                journal.event("posted:" + payment.id());
                return true;
            } catch (ClearingException failure) {
                payment.failure = failure.reason;
                payment.status = Status.REJECTED;
                journal.event("rejected:" + failure.reason);
                return false;
            }
        }

        boolean reverse(String reference) throws ClearingException {
            Payment payment = payments.require(reference);
            if (payment.status != Status.POSTED) {
                return false;
            }
            Account source = accounts.require(payment.from);
            Account target = accounts.require(payment.to);
            Account feeAccount = treasury(payment.amount.currency);
            long total = payment.amount.cents + payment.fee;
            try (AtomicPosting transaction = new AtomicPosting(List.of(source, target, feeAccount), journal)) {
                target.reserve("reverse:" + reference, payment.amount.cents);
                target.capture("reverse:" + reference);
                feeAccount.reserve("reverse:" + reference, payment.fee);
                feeAccount.capture("reverse:" + reference);
                source.credit(total);
                journal.append("reverse:" + reference, target, -payment.amount.cents);
                journal.append("reverse:" + reference, feeAccount, -payment.fee);
                journal.append("reverse:" + reference, source, total);
                payment.transition(Status.POSTED, Status.REVERSED);
                transaction.commit();
                return true;
            }
        }

        void reconcile() {
            EnumMap<Currency, Long> totals = new EnumMap<>(Currency.class);
            for (Account account : accounts) {
                if (account.balance < 0 || account.held() != 0 || account.available() != account.balance) {
                    throw new IllegalStateException("account invariant " + account.id);
                }
                totals.merge(account.currency, account.balance, Math::addExact);
            }
            if (!totals.equals(opening)) {
                throw new IllegalStateException("money not conserved");
            }
            for (Currency currency : Currency.values()) {
                if (journal.sum(currency) != 0) {
                    throw new IllegalStateException("unbalanced journal");
                }
            }
            for (Payment payment : payments) {
                if (!payment.status.terminal()) {
                    throw new IllegalStateException("unfinished payment");
                }
            }
        }

        Map<Status, Long> statuses() {
            Map<Status, Long> result = new EnumMap<>(Status.class);
            for (Payment payment : payments) {
                result.merge(payment.status, 1L, Long::sum);
            }
            return result;
        }

        List<Transfer> settlement(Currency currency) {
            List<Transfer> transfers = new ArrayList<>();
            for (Payment payment : payments) {
                if (payment.status == Status.POSTED && payment.amount.currency == currency) {
                    transfers.add(new Transfer(payment.from, payment.to, payment.amount.cents));
                }
            }
            return Settlement.compress(transfers);
        }
    }

    static final class Csv {
        static List<String> parse(String text) {
            List<String> fields = new ArrayList<>();
            StringBuilder field = new StringBuilder();
            boolean quoted = false;
            for (int i = 0; i < text.length(); i++) {
                char ch = text.charAt(i);
                if (ch == '"') {
                    if (quoted && i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        field.append('"');
                        i++;
                    } else {
                        quoted = !quoted;
                    }
                } else if (ch == ',' && !quoted) {
                    fields.add(field.toString());
                    field.setLength(0);
                } else {
                    field.append(ch);
                }
            }
            if (quoted) {
                throw new IllegalArgumentException("unterminated CSV string");
            }
            fields.add(field.toString());
            return fields;
        }

        static String encode(List<String> values) {
            List<String> fields = new ArrayList<>();
            for (String value : values) {
                if (value.indexOf(',') >= 0 || value.indexOf('"') >= 0 || value.indexOf('\n') >= 0) {
                    fields.add('"' + value.replace("\"", "\"\"") + '"');
                } else {
                    fields.add(value);
                }
            }
            return String.join(",", fields);
        }
    }

    static final class Analytics {
        static int lowerBound(long[] sorted, long key) {
            int left = 0;
            int right = sorted.length;
            while (left < right) {
                int middle = left + (right - left) / 2;
                if (sorted[middle] < key) {
                    left = middle + 1;
                } else {
                    right = middle;
                }
            }
            return left;
        }

        static long inversionCount(long[] values) {
            long count = 0;
            for (int i = 0; i < values.length; i++) {
                for (int j = i + 1; j < values.length; j++) {
                    if (values[i] > values[j]) {
                        count++;
                    }
                }
            }
            return count;
        }

        static long maxWindow(long[] values, int width) {
            if (width <= 0 || width > values.length) {
                return 0;
            }
            long sum = 0;
            for (int i = 0; i < width; i++) {
                sum += values[i];
            }
            long result = sum;
            for (int i = width; i < values.length; i++) {
                sum += values[i] - values[i - width];
                result = Math.max(result, sum);
            }
            return result;
        }

        static long[][] prefix(long[][] grid) {
            int rows = grid.length;
            int columns = rows == 0 ? 0 : grid[0].length;
            long[][] sums = new long[rows + 1][columns + 1];
            for (int row = 0; row < rows; row++) {
                if (grid[row].length != columns) {
                    throw new IllegalArgumentException("ragged grid");
                }
                for (int col = 0; col < columns; col++) {
                    sums[row + 1][col + 1] = grid[row][col] + sums[row][col + 1]
                            + sums[row + 1][col] - sums[row][col];
                }
            }
            return sums;
        }

        static long rectangle(long[][] prefix, int top, int left, int bottom, int right) {
            return prefix[bottom][right] - prefix[top][right] - prefix[bottom][left] + prefix[top][left];
        }

        static List<String> largest(Repository<Account> accounts, int count) {
            return accounts.matching(account -> !account.id.startsWith("fees:"))
                    .stream()
                    .sorted(Comparator.comparingLong((Account account) -> account.balance).reversed()
                            .thenComparing(Account::id))
                    .limit(Math.max(0, count))
                    .map(Account::id)
                    .toList();
        }
    }

    static final class AuditResource implements AutoCloseable {
        final String name;
        final List<String> trace;
        final boolean fail;

        AuditResource(String name, List<String> trace, boolean fail) {
            this.name = name;
            this.trace = trace;
            this.fail = fail;
            trace.add("open:" + name);
        }

        @Override
        public void close() throws IOException {
            trace.add("close:" + name);
            if (fail) {
                throw new IOException(name);
            }
        }
    }

    static List<String> cleanup(boolean bodyFailure, boolean closeFailure) {
        List<String> trace = new ArrayList<>();
        try (AuditResource first = new AuditResource("first", trace, closeFailure);
             AuditResource second = new AuditResource("second", trace, closeFailure)) {
            trace.add(first.name + "+" + second.name);
            if (bodyFailure) {
                throw new IOException("body");
            }
        } catch (IOException failure) {
            trace.add("caught:" + failure.getMessage());
            for (Throwable suppressed : failure.getSuppressed()) {
                trace.add("suppressed:" + suppressed.getMessage());
            }
        } finally {
            trace.add("finally");
        }
        return trace;
    }

    static long checksum(String text) {
        long hash = 2166136261L;
        for (byte value : text.getBytes(StandardCharsets.UTF_8)) {
            hash = ((hash ^ (value & 255)) * 16777619L) & 0xffffffffL;
        }
        return hash;
    }

    record Config(int size, long seed, boolean inject) {
        Config {
            size = Math.max(0, Math.min(180, size));
        }

        static Config parse(String text) {
            try (Scanner scanner = new Scanner(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)),
                    StandardCharsets.UTF_8)) {
                int count = scanner.hasNextInt() ? scanner.nextInt() : 24;
                long seed = scanner.hasNextLong() ? scanner.nextLong() : 19;
                boolean inject = scanner.hasNextInt() && scanner.nextInt() != 0;
                return new Config(count, seed, inject);
            }
        }
    }

    static final class Generator {
        long state;

        Generator(long seed) {
            state = seed;
        }

        int next(int bound) {
            state = state * 6364136223846793005L + 1442695040888963407L;
            return (int) Long.remainderUnsigned(state, bound);
        }

        ClearingEngine accounts() {
            ClearingEngine engine = new ClearingEngine();
            for (Currency currency : Currency.values()) {
                engine.addAccount(new Account("fees:" + currency, currency, Tier.GOLD, 0));
                for (int i = 0; i < 6; i++) {
                    String id = currency + ":" + i;
                    Account account = i == 5
                            ? new BusinessAccount(id, currency, 250_000, 900_000)
                            : new Account(id, currency, Tier.values()[i % 3], 100_000 + next(100_000));
                    engine.addAccount(account);
                }
            }
            return engine;
        }

        List<Payment> payments(int count) {
            List<Payment> result = new ArrayList<>();
            for (int i = 0; i < count; i++) {
                Currency currency = Currency.values()[next(3)];
                int from = next(6);
                int to = (from + 1 + next(5)) % 6;
                long amount = 1 + next(80_000);
                String source = currency + ":" + from;
                String target = currency + ":" + to;
                if (i % 17 == 3) {
                    target = "missing";
                }
                if (i % 19 == 7) {
                    amount = -1;
                }
                List<String> dependencies = i > 0 && i % 11 == 0 ? List.of("P" + (i - 1)) : List.of();
                result.add(new Payment("P" + i, source, target, new Money(currency, amount), dependencies));
            }
            return result;
        }
    }

    static String run(Config config) throws ClearingException {
        Generator generator = new Generator(config.seed);
        ClearingEngine engine = generator.accounts();
        List<Payment> payments = generator.payments(config.size);
        for (int i = 0; i < payments.size(); i++) {
            Payment payment = payments.get(i);
            engine.submit(payment, config.inject && i % 13 == 2);
        }
        for (Payment payment : engine.payments.matching(value -> value.status == Status.POSTED)) {
            if (payment.reference.hashCode() % 7 == 0) {
                try {
                    engine.reverse(payment.reference);
                } catch (ClearingException unavailable) {
                    engine.journal.event("reverse-failed:" + unavailable.reason);
                }
            }
        }
        engine.reconcile();
        StringBuilder text = new StringBuilder();
        text.append("=== Clearing house / Клиринг ===\n");
        text.append("size=").append(config.size).append(" seed=").append(config.seed).append('\n');
        text.append("status=").append(engine.statuses()).append('\n');
        text.append("accounts=").append(engine.accounts.size()).append(" rollbacks=").append(engine.rollbacks).append('\n');
        for (Currency currency : Currency.values()) {
            text.append(currency).append(" fees=").append(engine.treasury(currency).balance)
                    .append(" settlement=").append(engine.settlement(currency).size()).append('\n');
        }
        long[] balances = engine.accounts.project(account -> account.balance).stream().mapToLong(Long::longValue).toArray();
        long disorder = Analytics.inversionCount(balances);
        Arrays.sort(balances);
        text.append("analytics=").append(disorder).append(',').append(Analytics.lowerBound(balances, 100_000))
                .append(',').append(Analytics.maxWindow(balances, 3)).append('\n');
        text.append("largest=").append(String.join(",", Analytics.largest(engine.accounts, 3))).append('\n');
        text.append("cleanup=").append(String.join("|", cleanup(true, true))).append('\n');
        text.append("csv=").append(Csv.encode(Csv.parse("\"Алматы,банк\",\"a\"\"b\",42"))).append('\n');
        Set<Failure> failures = EnumSet.noneOf(Failure.class);
        for (Payment payment : engine.payments) {
            if (payment.failure != null) {
                failures.add(payment.failure);
            }
        }
        text.append("failures=").append(failures).append('\n');
        text.append("checksum=").append(checksum(text.toString())).append('\n');
        return text.toString();
    }

    public static void main(String[] args) throws Exception {
        String input = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
        Config config = Config.parse(input);
        try (Formatter formatter = new Formatter(System.out, Locale.ROOT)) {
            formatter.format("%s", run(config));
            formatter.flush();
        }
    }
}
