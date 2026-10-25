import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
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

/** An in-memory relational engine and a deliberately small query language. */
public final class QueryForge {
    private QueryForge() {
    }

    enum Kind {
        NUMBER, TEXT, NULL;
    }

    record Value(Kind kind, long number, String text) implements Comparable<Value> {
        static final Value NULL = new Value(Kind.NULL, 0, "");

        Value {
            Objects.requireNonNull(kind);
            Objects.requireNonNull(text);
        }

        static Value number(long number) {
            return new Value(Kind.NUMBER, number, "");
        }

        static Value text(String text) {
            return new Value(Kind.TEXT, 0, text);
        }

        long asLong() {
            if (kind != Kind.NUMBER) {
                throw new IllegalArgumentException("expected a number");
            }
            return number;
        }

        boolean truth() {
            return switch (kind) {
                case NUMBER -> number != 0;
                case TEXT -> !text.isEmpty();
                case NULL -> false;
            };
        }

        String display() {
            return switch (kind) {
                case NUMBER -> Long.toString(number);
                case TEXT -> text;
                case NULL -> "NULL";
            };
        }

        @Override
        public int compareTo(Value other) {
            if (kind != other.kind) {
                return Integer.compare(kind.ordinal(), other.kind.ordinal());
            }
            return switch (kind) {
                case NUMBER -> Long.compare(number, other.number);
                case TEXT -> text.compareTo(other.text);
                case NULL -> 0;
            };
        }
    }

    record Row(Map<String, Value> cells) {
        Row {
            cells = Collections.unmodifiableMap(new LinkedHashMap<>(cells));
        }

        Value get(String column) {
            Value result = cells.get(column);
            if (result == null) {
                throw new IllegalArgumentException("unknown column " + column);
            }
            return result;
        }

        Row with(String name, Value value) {
            Map<String, Value> result = new LinkedHashMap<>(cells);
            result.put(name, value);
            return new Row(result);
        }

        Row select(List<String> columns) {
            Map<String, Value> result = new LinkedHashMap<>();
            for (String column : columns) {
                result.put(column, get(column));
            }
            return new Row(result);
        }

        Row merge(Row other, String prefix) {
            Map<String, Value> result = new LinkedHashMap<>(cells);
            for (Map.Entry<String, Value> cell : other.cells.entrySet()) {
                String name = prefix + cell.getKey();
                if (result.putIfAbsent(name, cell.getValue()) != null) {
                    throw new IllegalArgumentException("ambiguous output " + name);
                }
            }
            return new Row(result);
        }

        String canonical() {
            return cells.entrySet().stream()
                    .map(entry -> entry.getKey().length() + ":" + entry.getKey() + "="
                            + entry.getValue().kind + ":" + entry.getValue().display().length()
                            + ":" + entry.getValue().display())
                    .collect(Collectors.joining("|"));
        }
    }

    record Column(String name, Kind kind, boolean nullable) {
        Column {
            if (name.isBlank()) {
                throw new IllegalArgumentException("empty column");
            }
        }
    }

    static final class Table implements Iterable<Row> {
        final String name;
        final List<Column> columns;
        final List<Row> rows = new ArrayList<>();
        final Map<String, Map<Value, List<Row>>> indexes = new HashMap<>();

        Table(String name, List<Column> columns) {
            this.name = name;
            this.columns = List.copyOf(columns);
            Set<String> names = new HashSet<>();
            for (Column column : columns) {
                if (!names.add(column.name)) {
                    throw new IllegalArgumentException("duplicate column");
                }
            }
        }

        void validate(Row row) {
            if (row.cells.size() != columns.size()) {
                throw new IllegalArgumentException("wrong column count");
            }
            for (Column column : columns) {
                Value value = row.get(column.name);
                if (value.kind == Kind.NULL) {
                    if (!column.nullable) {
                        throw new IllegalArgumentException("null in " + column.name);
                    }
                } else if (value.kind != column.kind) {
                    throw new IllegalArgumentException("type in " + column.name);
                }
            }
        }

        void insert(Row row) {
            validate(row);
            rows.add(row);
            for (Map.Entry<String, Map<Value, List<Row>>> index : indexes.entrySet()) {
                index.getValue().computeIfAbsent(row.get(index.getKey()), ignored -> new ArrayList<>()).add(row);
            }
        }

        void insertAll(Collection<Row> values) {
            for (Row row : values) {
                validate(row);
            }
            for (Row row : values) {
                insert(row);
            }
        }

        void index(String column) {
            if (columns.stream().noneMatch(value -> value.name.equals(column))) {
                throw new IllegalArgumentException("unknown index column");
            }
            Map<Value, List<Row>> index = new HashMap<>();
            for (Row row : rows) {
                index.computeIfAbsent(row.get(column), ignored -> new ArrayList<>()).add(row);
            }
            indexes.put(column, index);
        }

        List<Row> lookup(String column, Value value) {
            Map<Value, List<Row>> index = indexes.get(column);
            if (index != null) {
                return List.copyOf(index.getOrDefault(value, List.of()));
            }
            List<Row> result = new ArrayList<>();
            for (Row row : rows) {
                if (row.get(column).equals(value)) {
                    result.add(row);
                }
            }
            return result;
        }

        int delete(Predicate<Row> condition) {
            int before = rows.size();
            rows.removeIf(condition);
            rebuild();
            return before - rows.size();
        }

        void rebuild() {
            List<String> names = new ArrayList<>(indexes.keySet());
            indexes.clear();
            for (String name : names) {
                index(name);
            }
        }

        @Override
        public Iterator<Row> iterator() {
            return Collections.unmodifiableList(rows).iterator();
        }
    }

    static final class Database {
        final Map<String, Table> tables = new LinkedHashMap<>();

        void add(Table table) {
            if (tables.putIfAbsent(table.name, table) != null) {
                throw new IllegalArgumentException("duplicate table");
            }
        }

        Table table(String name) {
            Table result = tables.get(name);
            if (result == null) {
                throw new IllegalArgumentException("unknown table " + name);
            }
            return result;
        }

        Transaction transaction() {
            return new Transaction(this);
        }
    }

    static final class Transaction implements AutoCloseable {
        final Database database;
        final Map<String, List<Row>> snapshot = new LinkedHashMap<>();
        boolean committed;

        Transaction(Database database) {
            this.database = database;
            for (Table table : database.tables.values()) {
                snapshot.put(table.name, List.copyOf(table.rows));
            }
        }

        void commit() {
            committed = true;
        }

        @Override
        public void close() {
            if (committed) {
                return;
            }
            database.tables.keySet().removeIf(name -> !snapshot.containsKey(name));
            for (Map.Entry<String, List<Row>> entry : snapshot.entrySet()) {
                Table table = database.table(entry.getKey());
                table.rows.clear();
                table.rows.addAll(entry.getValue());
                table.rebuild();
            }
        }
    }

    enum TokenKind {
        WORD, NUMBER, STRING, SYMBOL, END;
    }

    record Token(TokenKind kind, String text, int offset) {
        boolean is(String value) {
            return text.equalsIgnoreCase(value);
        }
    }

    static final class SyntaxException extends IllegalArgumentException {
        private static final long serialVersionUID = 1L;
        final int offset;

        SyntaxException(String message, int offset) {
            super(message + " at " + offset);
            this.offset = offset;
        }
    }

    static final class Lexer {
        final String source;
        int offset;

        Lexer(String source) {
            this.source = source;
        }

        List<Token> scan() {
            List<Token> result = new ArrayList<>();
            while (offset < source.length()) {
                char ch = source.charAt(offset);
                if (Character.isWhitespace(ch)) {
                    offset++;
                    continue;
                }
                int start = offset;
                if (Character.isLetter(ch) || ch == '_') {
                    do {
                        offset++;
                    } while (offset < source.length() && (Character.isLetterOrDigit(source.charAt(offset))
                            || source.charAt(offset) == '_' || source.charAt(offset) == '.'));
                    result.add(new Token(TokenKind.WORD, source.substring(start, offset), start));
                } else if (Character.isDigit(ch)) {
                    while (offset < source.length() && Character.isDigit(source.charAt(offset))) {
                        offset++;
                    }
                    result.add(new Token(TokenKind.NUMBER, source.substring(start, offset), start));
                } else if (ch == '\'') {
                    result.add(string());
                } else {
                    offset++;
                    String symbol = Character.toString(ch);
                    if (offset < source.length() && "<>=!".indexOf(ch) >= 0 && source.charAt(offset) == '=') {
                        symbol += source.charAt(offset++);
                    }
                    if (!Set.of("+", "-", "*", "/", "%", "(", ")", ",", "=", "!=", "<", ">", "<=", ">=").contains(symbol)) {
                        throw new SyntaxException("invalid symbol", start);
                    }
                    result.add(new Token(TokenKind.SYMBOL, symbol, start));
                }
            }
            result.add(new Token(TokenKind.END, "", source.length()));
            return result;
        }

        Token string() {
            int start = offset++;
            StringBuilder text = new StringBuilder();
            while (offset < source.length()) {
                char ch = source.charAt(offset++);
                if (ch != '\'') {
                    text.append(ch);
                } else if (offset < source.length() && source.charAt(offset) == '\'') {
                    text.append('\'');
                    offset++;
                } else {
                    return new Token(TokenKind.STRING, text.toString(), start);
                }
            }
            throw new SyntaxException("unclosed string", start);
        }
    }

    sealed interface Expr permits Literal, Field, Unary, Binary, Call {
        Value evaluate(Row row);
    }

    record Literal(Value value) implements Expr {
        @Override
        public Value evaluate(Row row) {
            return value;
        }
    }

    record Field(String name) implements Expr {
        @Override
        public Value evaluate(Row row) {
            return row.get(name);
        }
    }

    record Unary(String operator, Expr input) implements Expr {
        @Override
        public Value evaluate(Row row) {
            Value value = input.evaluate(row);
            return switch (operator) {
                case "-" -> value.kind == Kind.NULL ? Value.NULL : Value.number(Math.negateExact(value.asLong()));
                case "NOT" -> Value.number(value.truth() ? 0 : 1);
                default -> throw new IllegalArgumentException("unary operator");
            };
        }
    }

    record Binary(String operator, Expr left, Expr right) implements Expr {
        @Override
        public Value evaluate(Row row) {
            Value a = left.evaluate(row);
            if (operator.equals("AND") && !a.truth()) {
                return Value.number(0);
            }
            if (operator.equals("OR") && a.truth()) {
                return Value.number(1);
            }
            Value b = right.evaluate(row);
            if (operator.equals("AND") || operator.equals("OR")) {
                return Value.number(b.truth() ? 1 : 0);
            }
            if (a.kind == Kind.NULL || b.kind == Kind.NULL) {
                return Value.NULL;
            }
            return switch (operator) {
                case "+" -> Value.number(Math.addExact(a.asLong(), b.asLong()));
                case "-" -> Value.number(Math.subtractExact(a.asLong(), b.asLong()));
                case "*" -> Value.number(Math.multiplyExact(a.asLong(), b.asLong()));
                case "/" -> Value.number(a.asLong() / b.asLong());
                case "%" -> Value.number(a.asLong() % b.asLong());
                case "=" -> Value.number(a.equals(b) ? 1 : 0);
                case "!=" -> Value.number(a.equals(b) ? 0 : 1);
                case "<" -> Value.number(a.compareTo(b) < 0 ? 1 : 0);
                case ">" -> Value.number(a.compareTo(b) > 0 ? 1 : 0);
                case "<=" -> Value.number(a.compareTo(b) <= 0 ? 1 : 0);
                case ">=" -> Value.number(a.compareTo(b) >= 0 ? 1 : 0);
                default -> throw new IllegalArgumentException("binary operator");
            };
        }
    }

    record Call(String name, List<Expr> arguments) implements Expr {
        Call {
            arguments = List.copyOf(arguments);
        }

        @Override
        public Value evaluate(Row row) {
            if (name.equals("COALESCE")) {
                for (Expr argument : arguments) {
                    Value value = argument.evaluate(row);
                    if (value.kind != Kind.NULL) {
                        return value;
                    }
                }
                return Value.NULL;
            }
            if (arguments.size() != 1) {
                throw new IllegalArgumentException("one argument required");
            }
            Value value = arguments.get(0).evaluate(row);
            if (name.equals("ISNULL")) {
                return Value.number(value.kind == Kind.NULL ? 1 : 0);
            }
            if (value.kind == Kind.NULL) {
                return Value.NULL;
            }
            return switch (name) {
                case "ABS" -> Value.number(Math.absExact(value.asLong()));
                case "LENGTH" -> Value.number(value.display().length());
                case "LOWER" -> Value.text(value.display().toLowerCase(Locale.ROOT));
                default -> throw new IllegalArgumentException("unknown function " + name);
            };
        }
    }

    record Projection(String alias, Expr expression) {
    }

    record Plan(String table, List<Projection> projections, Expr where, String order, boolean descending,
                int limit, boolean distinct) {
        Plan {
            projections = List.copyOf(projections);
        }
    }

    static final class Parser {
        final List<Token> tokens;
        int at;

        Parser(String text) {
            tokens = new Lexer(text).scan();
        }

        Token peek() {
            return tokens.get(at);
        }

        Token take() {
            Token token = peek();
            if (token.kind != TokenKind.END) {
                at++;
            }
            return token;
        }

        boolean accept(String text) {
            if (!peek().is(text)) {
                return false;
            }
            take();
            return true;
        }

        void expect(String text) {
            if (!accept(text)) {
                throw new SyntaxException("expected " + text, peek().offset);
            }
        }

        String word() {
            Token token = take();
            if (token.kind != TokenKind.WORD) {
                throw new SyntaxException("expected identifier", token.offset);
            }
            return token.text;
        }

        Plan parse() {
            expect("SELECT");
            boolean distinct = accept("DISTINCT");
            List<Projection> projections = new ArrayList<>();
            do {
                Expr value = expression(0);
                String name = accept("AS") ? word() : value instanceof Field field ? field.name : "expr" + projections.size();
                if (projections.stream().anyMatch(projection -> projection.alias.equals(name))) {
                    throw new SyntaxException("duplicate projection", peek().offset);
                }
                projections.add(new Projection(name, value));
            } while (accept(","));
            expect("FROM");
            String table = word();
            Expr where = accept("WHERE") ? expression(0) : new Literal(Value.number(1));
            String order = "";
            boolean descending = false;
            if (accept("ORDER")) {
                expect("BY");
                order = word();
                descending = accept("DESC");
                if (!descending) {
                    accept("ASC");
                }
            }
            int limit = Integer.MAX_VALUE;
            if (accept("LIMIT")) {
                Token token = take();
                if (token.kind != TokenKind.NUMBER) {
                    throw new SyntaxException("expected limit", token.offset);
                }
                limit = Integer.parseInt(token.text);
            }
            if (peek().kind != TokenKind.END) {
                throw new SyntaxException("unexpected token", peek().offset);
            }
            return new Plan(table, projections, where, order, descending, limit, distinct);
        }

        int precedence(String operator) {
            return switch (operator.toUpperCase(Locale.ROOT)) {
                case "OR" -> 1;
                case "AND" -> 2;
                case "=", "!=", "<", ">", "<=", ">=" -> 3;
                case "+", "-" -> 4;
                case "*", "/", "%" -> 5;
                default -> -1;
            };
        }

        Expr expression(int minimum) {
            Expr result = primary();
            while (true) {
                String operator = peek().text.toUpperCase(Locale.ROOT);
                int priority = precedence(operator);
                if (priority < minimum) {
                    return result;
                }
                take();
                result = new Binary(operator, result, expression(priority + 1));
            }
        }

        Expr primary() {
            Token token = take();
            if (token.is("-")) {
                return new Unary("-", expression(6));
            }
            if (token.is("NOT")) {
                return new Unary("NOT", expression(3));
            }
            if (token.is("(")) {
                Expr nested = expression(0);
                expect(")");
                return nested;
            }
            if (token.kind == TokenKind.NUMBER) {
                return new Literal(Value.number(Long.parseLong(token.text)));
            }
            if (token.kind == TokenKind.STRING) {
                return new Literal(Value.text(token.text));
            }
            if (token.is("NULL")) {
                return new Literal(Value.NULL);
            }
            if (token.kind != TokenKind.WORD) {
                throw new SyntaxException("expected expression", token.offset);
            }
            if (!accept("(")) {
                return new Field(token.text);
            }
            List<Expr> arguments = new ArrayList<>();
            if (!accept(")")) {
                do {
                    arguments.add(expression(0));
                } while (accept(","));
                expect(")");
            }
            return new Call(token.text.toUpperCase(Locale.ROOT), arguments);
        }
    }

    static final class Executor {
        final Database database;
        long scanned;
        long projected;

        Executor(Database database) {
            this.database = database;
        }

        List<Row> execute(Plan plan) {
            List<Row> result = new ArrayList<>();
            for (Row row : database.table(plan.table)) {
                scanned++;
                if (!plan.where.evaluate(row).truth()) {
                    continue;
                }
                Map<String, Value> cells = new LinkedHashMap<>();
                for (Projection projection : plan.projections) {
                    cells.put(projection.alias, projection.expression.evaluate(row));
                }
                result.add(new Row(cells));
                projected++;
            }
            if (plan.distinct) {
                result = distinct(result);
            }
            if (!plan.order.isEmpty()) {
                Comparator<Row> comparator = Comparator.comparing(row -> row.get(plan.order));
                result.sort(plan.descending ? comparator.reversed() : comparator);
            }
            if (result.size() > plan.limit) {
                result = new ArrayList<>(result.subList(0, plan.limit));
            }
            return result;
        }

        List<Row> query(String text) {
            return execute(new Parser(text).parse());
        }

        static List<Row> distinct(List<Row> rows) {
            Set<Map<String, Value>> seen = new HashSet<>();
            List<Row> result = new ArrayList<>();
            for (Row row : rows) {
                if (seen.add(row.cells)) {
                    result.add(row);
                }
            }
            return result;
        }

        static List<Row> union(List<Row> left, List<Row> right, boolean all) {
            List<Row> result = new ArrayList<>(left);
            result.addAll(right);
            return all ? result : distinct(result);
        }

        static List<Row> difference(List<Row> left, List<Row> right) {
            Set<Map<String, Value>> excluded = new HashSet<>();
            for (Row row : right) {
                excluded.add(row.cells);
            }
            List<Row> result = new ArrayList<>();
            for (Row row : distinct(left)) {
                if (!excluded.contains(row.cells)) {
                    result.add(row);
                }
            }
            return result;
        }

        static List<Row> nestedJoin(List<Row> left, List<Row> right, String a, String b, String prefix) {
            List<Row> result = new ArrayList<>();
            for (Row first : left) {
                for (Row second : right) {
                    Value key = first.get(a);
                    if (key.kind != Kind.NULL && key.equals(second.get(b))) {
                        result.add(first.merge(second, prefix));
                    }
                }
            }
            return result;
        }

        static List<Row> hashJoin(List<Row> left, List<Row> right, String a, String b, String prefix) {
            Map<Value, List<Row>> index = new HashMap<>();
            for (Row row : right) {
                if (row.get(b).kind != Kind.NULL) {
                    index.computeIfAbsent(row.get(b), ignored -> new ArrayList<>()).add(row);
                }
            }
            List<Row> result = new ArrayList<>();
            for (Row row : left) {
                for (Row match : index.getOrDefault(row.get(a), List.of())) {
                    result.add(row.merge(match, prefix));
                }
            }
            return result;
        }
    }

    record Aggregate(Value key, long count, long total, Value minimum, Value maximum) {
    }

    static final class Grouping {
        static List<Aggregate> group(List<Row> rows, String keyColumn, String numberColumn) {
            Map<Value, List<Value>> groups = new TreeMap<>();
            for (Row row : rows) {
                groups.computeIfAbsent(row.get(keyColumn), ignored -> new ArrayList<>()).add(row.get(numberColumn));
            }
            List<Aggregate> result = new ArrayList<>();
            for (Map.Entry<Value, List<Value>> group : groups.entrySet()) {
                long count = 0;
                long sum = 0;
                Value min = Value.NULL;
                Value max = Value.NULL;
                for (Value value : group.getValue()) {
                    if (value.kind == Kind.NULL) {
                        continue;
                    }
                    count++;
                    sum = Math.addExact(sum, value.asLong());
                    if (min.kind == Kind.NULL || value.compareTo(min) < 0) {
                        min = value;
                    }
                    if (max.kind == Kind.NULL || value.compareTo(max) > 0) {
                        max = value;
                    }
                }
                result.add(new Aggregate(group.getKey(), count, sum, min, max));
            }
            return result;
        }

        static long[] runningTotal(long[] input) {
            long[] result = new long[input.length];
            long sum = 0;
            for (int i = 0; i < input.length; i++) {
                sum = Math.addExact(sum, input[i]);
                result[i] = sum;
            }
            return result;
        }

        static int[] denseRank(long[] sorted) {
            int[] result = new int[sorted.length];
            int rank = 0;
            for (int i = 0; i < sorted.length; i++) {
                if (i == 0 || sorted[i] != sorted[i - 1]) {
                    rank++;
                }
                result[i] = rank;
            }
            return result;
        }

        static long median(long[] values) {
            if (values.length == 0) {
                throw new IllegalArgumentException("empty median");
            }
            long[] sorted = values.clone();
            Arrays.sort(sorted);
            return sorted[(sorted.length - 1) / 2];
        }
    }

    static final class Delimited {
        static List<List<String>> parse(String source) {
            List<List<String>> rows = new ArrayList<>();
            List<String> row = new ArrayList<>();
            StringBuilder field = new StringBuilder();
            boolean quoted = false;
            boolean pending = false;
            for (int i = 0; i < source.length(); i++) {
                char ch = source.charAt(i);
                pending = true;
                if (ch == '"') {
                    if (quoted && i + 1 < source.length() && source.charAt(i + 1) == '"') {
                        field.append('"');
                        i++;
                    } else {
                        quoted = !quoted;
                    }
                } else if (!quoted && (ch == ',' || ch == '\n')) {
                    row.add(field.toString());
                    field.setLength(0);
                    if (ch == '\n') {
                        rows.add(List.copyOf(row));
                        row.clear();
                        pending = false;
                    }
                } else if (ch != '\r' || quoted) {
                    field.append(ch);
                }
            }
            if (quoted) {
                throw new IllegalArgumentException("unclosed CSV quote");
            }
            if (pending) {
                row.add(field.toString());
                rows.add(List.copyOf(row));
            }
            return rows;
        }

        static String encode(List<List<String>> rows) {
            StringBuilder result = new StringBuilder();
            for (List<String> row : rows) {
                for (int i = 0; i < row.size(); i++) {
                    if (i > 0) {
                        result.append(',');
                    }
                    result.append('"').append(row.get(i).replace("\"", "\"\"")).append('"');
                }
                result.append('\n');
            }
            return result.toString();
        }

        static Table importTable(String name, List<Column> columns, String csv) {
            Table result = new Table(name, columns);
            for (List<String> row : parse(csv)) {
                if (row.size() != columns.size()) {
                    throw new IllegalArgumentException("CSV width");
                }
                Map<String, Value> cells = new LinkedHashMap<>();
                for (int i = 0; i < columns.size(); i++) {
                    Column column = columns.get(i);
                    String value = row.get(i);
                    cells.put(column.name, value.equals("\\N") ? Value.NULL
                            : column.kind == Kind.NUMBER ? Value.number(Long.parseLong(value)) : Value.text(value));
                }
                result.insert(new Row(cells));
            }
            return result;
        }
    }

    static final class MemoryCursor implements AutoCloseable {
        final List<Row> rows;
        final List<String> trace;
        int index;
        boolean closed;

        MemoryCursor(List<Row> rows, List<String> trace) {
            this.rows = rows;
            this.trace = trace;
            trace.add("open");
        }

        Optional<Row> next() throws IOException {
            if (closed) {
                throw new IOException("closed cursor");
            }
            return index < rows.size() ? Optional.of(rows.get(index++)) : Optional.empty();
        }

        @Override
        public void close() {
            closed = true;
            trace.add("close:" + index);
        }
    }

    static long consume(List<Row> rows, List<String> trace) throws IOException {
        long total = 0;
        try (MemoryCursor cursor = new MemoryCursor(rows, trace)) {
            Optional<Row> row;
            while ((row = cursor.next()).isPresent()) {
                try {
                    total += row.orElseThrow().get("amount").asLong();
                } catch (IllegalArgumentException badRow) {
                    trace.add("skip");
                    continue;
                } finally {
                    trace.add("step");
                }
            }
        } finally {
            trace.add("done");
        }
        return total;
    }

    static Row row(long id, String region, long amount) {
        Map<String, Value> cells = new LinkedHashMap<>();
        cells.put("id", Value.number(id));
        cells.put("region", Value.text(region));
        cells.put("amount", Value.number(amount));
        return new Row(cells);
    }

    static Database generate(int size, long seed) {
        Database database = new Database();
        Table sales = new Table("sales", List.of(new Column("id", Kind.NUMBER, false),
                new Column("region", Kind.TEXT, false), new Column("amount", Kind.NUMBER, false)));
        long state = seed;
        String[] regions = {"Алматы", "Астана", "Шымкент", "Орал"};
        for (int i = 0; i < size; i++) {
            state = state * 2862933555777941757L + 3037000493L;
            long amount = Long.remainderUnsigned(state, 10000);
            sales.insert(row(i, regions[i % regions.length], amount));
        }
        sales.index("id");
        database.add(sales);
        Table regionsTable = new Table("regions", List.of(new Column("name", Kind.TEXT, false),
                new Column("weight", Kind.NUMBER, false)));
        for (int i = 0; i < regions.length; i++) {
            Map<String, Value> cells = new LinkedHashMap<>();
            cells.put("name", Value.text(regions[i]));
            cells.put("weight", Value.number(i + 1));
            regionsTable.insert(new Row(cells));
        }
        database.add(regionsTable);
        return database;
    }

    static String renderRows(List<Row> rows) {
        List<List<String>> values = new ArrayList<>();
        for (Row row : rows) {
            values.add(row.cells.values().stream().map(Value::display).toList());
        }
        return Delimited.encode(values);
    }

    static long checksum(String text) {
        long hash = 0;
        for (int i = 0; i < text.length(); i++) {
            hash = (hash * 131 + text.charAt(i)) & 0xffffffffL;
        }
        return hash;
    }

    static String run(int size, long seed) throws IOException {
        size = Math.max(0, Math.min(220, size));
        Database database = generate(size, seed);
        Executor executor = new Executor(database);
        List<Row> selected = executor.query("SELECT id, LOWER(region) AS city, amount * 2 + 3 AS score FROM sales WHERE amount >= 2000 AND id % 3 != 1 ORDER BY score DESC LIMIT 7");
        List<Row> joined = Executor.hashJoin(database.table("sales").rows, database.table("regions").rows,
                "region", "name", "r.");
        List<Aggregate> grouped = Grouping.group(database.table("sales").rows, "region", "amount");
        List<String> trace = new ArrayList<>();
        long consumed = consume(database.table("sales").rows, trace);
        int before = database.table("sales").rows.size();
        try (Transaction transaction = database.transaction()) {
            database.table("sales").delete(value -> value.get("id").asLong() % 4 == 0);
            if (database.table("sales").rows.size() == before) {
                transaction.commit();
            }
        }
        StringBuilder text = new StringBuilder("=== Query forge / Запросы ===\n");
        text.append("size=").append(size).append(" seed=").append(seed).append('\n');
        text.append("selected=").append(selected.size()).append(" joined=").append(joined.size()).append('\n');
        text.append(renderRows(selected));
        for (Aggregate group : grouped) {
            text.append(group.key.display()).append(':').append(group.count).append(':')
                    .append(group.total).append(':').append(group.minimum.display()).append('\n');
        }
        long[] amounts = database.table("sales").rows.stream().mapToLong(row -> row.get("amount").asLong()).toArray();
        long[] prefix = Grouping.runningTotal(amounts);
        text.append("total=").append(consumed).append(" prefix=").append(prefix.length == 0 ? 0 : prefix[prefix.length - 1]).append('\n');
        text.append("restored=").append(database.table("sales").rows.size()).append(" trace=").append(trace.size()).append('\n');
        text.append("metrics=").append(executor.scanned).append(',').append(executor.projected).append('\n');
        text.append("checksum=").append(checksum(text.toString())).append('\n');
        return text.toString();
    }

    public static void main(String[] args) throws IOException {
        try (Scanner scanner = new Scanner(System.in, StandardCharsets.UTF_8)) {
            int size = scanner.hasNextInt() ? scanner.nextInt() : 32;
            long seed = scanner.hasNextLong() ? scanner.nextLong() : 29;
            System.out.printf(Locale.ROOT, "%s", run(size, seed));
        }
    }
}
