import org.junit.jupiter.api.Test;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import static org.junit.jupiter.api.Assertions.*;

class QueryForgeTest {
    QueryForge.Row row(long id, String region, long amount) {
        return QueryForge.row(id, region, amount);
    }

    QueryForge.Value evaluate(String expression) {
        var parser = new QueryForge.Parser("SELECT " + expression + " AS result FROM sales");
        return parser.parse().projections().get(0).expression().evaluate(row(3, "Алматы", 20));
    }

    @Test void precedenceParenthesesAndShortCircuitHaveIndependentExpectedValues() {
        assertEquals(14, evaluate("2+3*4").asLong());
        assertEquals(20, evaluate("(2+3)*4").asLong());
        assertEquals(2, evaluate("20 / 3 % 4").asLong());
        assertEquals(-6, evaluate("-3*2").asLong());
        assertEquals(1, evaluate("1 OR 1/0").asLong());
        assertEquals(0, evaluate("0 AND 1/0").asLong());
        assertEquals(1, evaluate("NOT amount<3 AND id=3").asLong());
        assertThrows(ArithmeticException.class, () -> evaluate("1/0"));
    }

    @Test void allComparisonOperatorsAndNullPropagationAreExplicit() {
        for (String expression : List.of("3=3", "3!=4", "2<3", "4>3", "3<=3", "3>=3")) {
            assertTrue(evaluate(expression).truth(), expression);
        }
        assertFalse(evaluate("3=4").truth());
        assertEquals(QueryForge.Value.NULL, evaluate("NULL+1"));
        assertEquals(QueryForge.Value.NULL, evaluate("NULL=NULL"));
        assertEquals(1, evaluate("ISNULL(NULL)").asLong());
        assertEquals(8, evaluate("COALESCE(NULL,8,1/0)").asLong());
        assertEquals(3, evaluate("ABS(-3)").asLong());
        assertEquals(6, evaluate("LENGTH(region)").asLong());
        assertEquals("алматы", evaluate("LOWER(region)").display());
        assertThrows(IllegalArgumentException.class, () -> evaluate("MYSTERY(1)"));
        assertThrows(IllegalArgumentException.class, () -> evaluate("ABS(1,2)"));
    }

    @Test void lexerHandlesQuotesUnicodeAndAccurateErrors() {
        var tokens = new QueryForge.Lexer("'О''Брайен' >= 42").scan();
        assertEquals("О'Брайен", tokens.get(0).text());
        assertEquals(">=", tokens.get(1).text());
        assertEquals(QueryForge.TokenKind.END, tokens.get(3).kind());
        var error = assertThrows(QueryForge.SyntaxException.class, () -> new QueryForge.Lexer("x @ 2").scan());
        assertEquals(2, error.offset);
        assertThrows(QueryForge.SyntaxException.class, () -> new QueryForge.Lexer("'unterminated").scan());
    }

    @Test void queryProjectionFilterOrderingAndLimitAreCorrect() {
        var database = QueryForge.generate(0, 1);
        database.table("sales").insertAll(List.of(row(1,"a",10),row(2,"b",40),row(3,"a",25)));
        var executor = new QueryForge.Executor(database);
        var result = executor.query("SELECT id, amount*2 AS score FROM sales WHERE amount>=20 ORDER BY score DESC LIMIT 1");
        assertEquals(1, result.size());
        assertEquals(2, result.get(0).get("id").asLong());
        assertEquals(80, result.get(0).get("score").asLong());
        assertEquals(3, executor.scanned);
        assertEquals(2, executor.projected);
        assertEquals(0, executor.query("SELECT id FROM sales LIMIT 0").size());
        assertEquals(3, executor.query("SELECT id FROM sales ORDER BY id ASC").size());
    }

    @Test void syntaxValidationRejectsInvalidAliasesMissingTokensAndTrailingGarbage() {
        for (String text : List.of("SELECT id,id FROM sales", "SELECT (1+2 FROM sales", "SELECT FROM sales",
                "SELECT id FROM sales garbage", "SELECT id FROM sales LIMIT -1", "SELECT 1 AS x,2 AS x FROM sales")) {
            assertThrows(IllegalArgumentException.class, () -> new QueryForge.Parser(text).parse(), text);
        }
        assertThrows(IllegalArgumentException.class, () -> new QueryForge.Executor(QueryForge.generate(0,1)).query("SELECT id FROM missing"));
    }

    @Test void indexesRemainCorrectAfterInsertDeleteAndRollback() {
        var database = QueryForge.generate(8, 2);
        var table = database.table("sales");
        var original = table.lookup("id", QueryForge.Value.number(2));
        assertEquals(1, original.size());
        try (var transaction = database.transaction()) {
            table.delete(value -> value.get("id").asLong()==2);
            assertTrue(table.lookup("id", QueryForge.Value.number(2)).isEmpty());
            table.insert(row(99,"a",17));
            assertFalse(transaction.committed);
        }
        assertEquals(original, table.lookup("id", QueryForge.Value.number(2)));
        assertTrue(table.lookup("id", QueryForge.Value.number(99)).isEmpty());
        try (var transaction = database.transaction()) {
            table.insert(row(99,"a",17));
            transaction.commit();
        }
        assertEquals(1, table.lookup("id", QueryForge.Value.number(99)).size());
    }

    @Test void schemaAndBulkInsertAreAtomicForValidationFailures() {
        var table = QueryForge.generate(0,1).table("sales");
        var wrong = new QueryForge.Row(Map.of("id",QueryForge.Value.text("bad"),"region",QueryForge.Value.text("x"),"amount",QueryForge.Value.number(2)));
        assertThrows(IllegalArgumentException.class, () -> table.insertAll(List.of(row(1,"a",1),wrong)));
        assertTrue(table.rows.isEmpty());
        assertThrows(IllegalArgumentException.class, () -> table.index("bad"));
        assertThrows(IllegalArgumentException.class, () -> table.insert(new QueryForge.Row(Map.of())));
        assertThrows(IllegalArgumentException.class, () -> table.insert(row(1,"x",1).with("amount",QueryForge.Value.NULL)));
        assertThrows(IllegalArgumentException.class, () -> new QueryForge.Table("x", List.of(new QueryForge.Column("a",QueryForge.Kind.NUMBER,false),new QueryForge.Column("a",QueryForge.Kind.NUMBER,false))));
    }

    @Test void hashJoinMatchesNestedLoopOracleIncludingDuplicatesAndNulls() {
        Random random = new Random(51);
        for (int round=0; round<20; round++) {
            List<QueryForge.Row> left = new ArrayList<>(), right = new ArrayList<>();
            for(int i=0;i<20;i++) {
                left.add(row(i,"c"+random.nextInt(5),i));
                right.add(row(i,"c"+random.nextInt(5),i));
            }
            left.add(row(90,"x",1).with("region", QueryForge.Value.NULL));
            right.add(row(91,"x",1).with("region", QueryForge.Value.NULL));
            var expected=QueryForge.Executor.nestedJoin(left,right,"region","region","r.");
            var actual=QueryForge.Executor.hashJoin(left,right,"region","region","r.");
            assertEquals(expected,actual);
            assertEquals(actual.size(),actual.stream().map(QueryForge.Row::canonical).distinct().count());
        }
    }

    @Test void groupingIgnoresNullAmountsAndMatchesIndependentTotals() {
        var rows=List.of(row(1,"a",10),row(2,"b",20),row(3,"a",40),row(4,"b",1).with("amount",QueryForge.Value.NULL));
        var result=QueryForge.Grouping.group(rows,"region","amount");
        assertEquals(2,result.size());
        assertEquals(50,result.get(0).total());
        assertEquals(2,result.get(0).count());
        assertEquals(10,result.get(0).minimum().asLong());
        assertEquals(40,result.get(0).maximum().asLong());
        assertEquals(20,result.get(1).total());
    }

    @Test void windowFunctionsAndMedianAgreeWithSmallOracles() {
        assertArrayEquals(new long[]{3,2,9,9},QueryForge.Grouping.runningTotal(new long[]{3,-1,7,0}));
        assertArrayEquals(new int[]{1,1,2,3,3},QueryForge.Grouping.denseRank(new long[]{2,2,5,8,8}));
        assertEquals(3,QueryForge.Grouping.median(new long[]{9,1,3,4}));
        assertThrows(IllegalArgumentException.class,()->QueryForge.Grouping.median(new long[0]));
    }

    @Test void rowImmutabilityProjectionAndSetOperationsAreCorrect() {
        var a=row(1,"a",4);var b=row(2,"b",5);
        assertThrows(UnsupportedOperationException.class,()->a.cells().clear());
        assertEquals(List.of("id"),new ArrayList<>(a.select(List.of("id")).cells().keySet()));
        assertEquals(6,a.merge(b,"r.").cells().size());
        assertThrows(IllegalArgumentException.class,()->a.merge(b,""));
        assertEquals(List.of(a,b),QueryForge.Executor.distinct(List.of(a,a,b)));
        assertEquals(List.of(a,b),QueryForge.Executor.union(List.of(a),List.of(a,b),false));
        assertEquals(3,QueryForge.Executor.union(List.of(a),List.of(a,b),true).size());
        assertEquals(List.of(a),QueryForge.Executor.difference(List.of(a,a,b),List.of(b)));
    }

    @Test void csvImportsEscapedUnicodeNullsAndMultilineFields() {
        var values=List.of(List.of("1","Алматы, юг","3"),List.of("2","О\"Брайен\nцентр","\\N"));
        String csv=QueryForge.Delimited.encode(values);
        assertEquals(values,QueryForge.Delimited.parse(csv));
        var schema=List.of(new QueryForge.Column("id",QueryForge.Kind.NUMBER,false),new QueryForge.Column("region",QueryForge.Kind.TEXT,false),new QueryForge.Column("amount",QueryForge.Kind.NUMBER,true));
        var table=QueryForge.Delimited.importTable("x",schema,csv);
        assertEquals(QueryForge.Value.NULL,table.rows.get(1).get("amount"));
        assertEquals(List.of(),QueryForge.Delimited.parse(""));
        assertThrows(IllegalArgumentException.class,()->QueryForge.Delimited.parse("\"x"));
        assertThrows(IllegalArgumentException.class,()->QueryForge.Delimited.importTable("x",schema,"1,2\n"));
    }

    @Test void cursorClosesOnContinueAndErrorAndRefusesReuse() throws Exception {
        List<String> trace=new ArrayList<>();
        assertEquals(5,QueryForge.consume(List.of(row(1,"a",5),row(2,"a",0).with("amount",QueryForge.Value.NULL)),trace));
        assertEquals(List.of("open","step","skip","step","close:2","done"),trace);
        var cursor=new QueryForge.MemoryCursor(List.of(),new ArrayList<>());
        assertTrue(cursor.next().isEmpty());
        cursor.close();
        assertThrows(java.io.IOException.class,cursor::next);
    }

    @Test void simulationsAreDeterministicAtEmptyAndMaximumSizes() throws Exception {
        for(int size:new int[]{0,1,32,220}) {
            assertEquals(QueryForge.run(size,71),QueryForge.run(size,71));
        }
        assertEquals(0,QueryForge.checksum(""));
        assertTrue(QueryForge.Value.text("a").compareTo(QueryForge.Value.NULL)<0);
        assertEquals(0,QueryForge.Value.NULL.compareTo(QueryForge.Value.NULL));
        assertThrows(IllegalArgumentException.class,()->QueryForge.Value.NULL.asLong());
    }

    @Test void realMainPreservesUtf8AndDefaultInput() throws Exception {
        var originalIn=System.in;var originalOut=System.out;
        var output=new ByteArrayOutputStream();
        try(var stream=new PrintStream(output,true,StandardCharsets.UTF_8)) {
            System.setIn(new ByteArrayInputStream("4 8".getBytes(StandardCharsets.UTF_8)));
            System.setOut(stream);
            QueryForge.main(new String[0]);
        } finally {
            System.setIn(originalIn);System.setOut(originalOut);
        }
        assertEquals(QueryForge.run(4,8),output.toString(StandardCharsets.UTF_8));
    }
}
