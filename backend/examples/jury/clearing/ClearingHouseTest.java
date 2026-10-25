import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Random;
import static org.junit.jupiter.api.Assertions.*;

class ClearingHouseTest {
    ClearingHouse.ClearingEngine bank() {
        ClearingHouse.ClearingEngine engine = new ClearingHouse.ClearingEngine();
        engine.addAccount(new ClearingHouse.Account("a", ClearingHouse.Currency.USD, ClearingHouse.Tier.STANDARD, 10000));
        engine.addAccount(new ClearingHouse.Account("b", ClearingHouse.Currency.USD, ClearingHouse.Tier.GOLD, 2000));
        engine.addAccount(new ClearingHouse.Account("fees:USD", ClearingHouse.Currency.USD, ClearingHouse.Tier.GOLD, 0));
        return engine;
    }

    ClearingHouse.Payment payment(String id, long amount) {
        return new ClearingHouse.Payment(id, "a", "b", new ClearingHouse.Money(ClearingHouse.Currency.USD, amount), List.of());
    }

    @Test void successfulPostingHasThreeBalancedEntries() throws Exception {
        var engine = bank();
        var value = payment("x", 1000);
        assertTrue(engine.submit(value, false));
        assertEquals(8995, engine.accounts.require("a").balance);
        assertEquals(3000, engine.accounts.require("b").balance);
        assertEquals(5, engine.treasury(ClearingHouse.Currency.USD).balance);
        assertEquals(3, engine.journal.entries.size());
        assertEquals(1, engine.journal.statement("a").size());
        assertEquals(-1005L, engine.journal.byAccount().get("a"));
        engine.reconcile();
    }

    @Test void exactAvailableBalanceCanBeReserved() throws Exception {
        var account = bank().accounts.require("a");
        account.reserve("h", 10000);
        assertEquals(0, account.available());
        assertEquals(10000, account.held());
        var ex = assertThrows(ClearingHouse.ClearingException.class, () -> account.reserve("another", 1));
        assertEquals(ClearingHouse.Failure.INSUFFICIENT_FUNDS, ex.reason);
        assertThrows(ClearingHouse.ClearingException.class, () -> account.reserve("h", 1));
        assertEquals(10000, account.release("h"));
        assertEquals(0, account.release("h"));
        assertThrows(ClearingHouse.ClearingException.class, () -> account.capture("h"));
    }

    @Test void failureAfterDebitRollsBackAccountsAndJournal() throws Exception {
        var engine = bank();
        assertFalse(engine.submit(payment("failed", 1000), true));
        assertEquals(10000, engine.accounts.require("a").balance);
        assertEquals(2000, engine.accounts.require("b").balance);
        assertEquals(0, engine.journal.entries.size());
        assertEquals(1, engine.rollbacks);
        engine.reconcile();
    }

    @Test void reversalRestoresOriginalMoneyAndCannotRepeat() throws Exception {
        var engine = bank();
        assertTrue(engine.submit(payment("x", 1000), false));
        assertTrue(engine.reverse("x"));
        assertFalse(engine.reverse("x"));
        assertEquals(10000, engine.accounts.require("a").balance);
        assertEquals(2000, engine.accounts.require("b").balance);
        assertEquals(0, engine.treasury(ClearingHouse.Currency.USD).balance);
        assertEquals(ClearingHouse.Status.REVERSED, engine.payments.require("x").status);
        engine.reconcile();
    }

    @Test void duplicateRejectionsAndFrozenAccountsAreExplicit() throws Exception {
        var engine = bank();
        assertTrue(engine.submit(payment("x", 100), false));
        assertFalse(engine.submit(payment("x", 100), false));
        engine.accounts.require("b").frozen = true;
        assertFalse(engine.submit(payment("y", 100), false));
        assertEquals(ClearingHouse.Failure.FROZEN, engine.payments.require("y").failure);
        engine.accounts.require("b").frozen = false;
        assertFalse(engine.submit(payment("z", 0), false));
        assertEquals(ClearingHouse.Failure.INVALID_AMOUNT, engine.payments.require("z").failure);
        engine.reconcile();
    }

    @Test void transactionDeduplicatesAliasedAccounts() throws Exception {
        var engine = bank();
        var a = engine.accounts.require("a");
        try (var tx = new ClearingHouse.AtomicPosting(List.of(a, a), engine.journal)) {
            a.credit(25);
            engine.journal.append("tmp", a, 25);
            assertFalse(tx.committed);
        }
        assertEquals(10000, a.balance);
        assertTrue(engine.journal.entries.isEmpty());
    }

    @Test void riskWindowExpiresAtExactBoundary() {
        var risk = new ClearingHouse.RiskWindow(3, 100);
        assertTrue(risk.accept("a", 0, 70));
        assertTrue(risk.accept("a", 1, 30));
        assertFalse(risk.accept("a", 2, 1));
        assertTrue(risk.accept("a", 3, 70));
        risk.clear("a");
        assertTrue(risk.accept("a", 4, 100));
        assertThrows(IllegalArgumentException.class, () -> new ClearingHouse.RiskWindow(0, 1));
    }

    @Test void nettingMatchesIndependentDoubleEntryOracle() {
        Random random = new Random(23);
        for (int round = 0; round < 25; round++) {
            List<ClearingHouse.Transfer> transfers = new ArrayList<>();
            long[] oracle = new long[7];
            for (int i = 0; i < 50; i++) {
                int a = random.nextInt(7), b = (a + 1 + random.nextInt(6)) % 7;
                int value = 1 + random.nextInt(300);
                transfers.add(new ClearingHouse.Transfer("a" + a, "a" + b, value));
                oracle[a] -= value;
                oracle[b] += value;
            }
            var compressed = ClearingHouse.Settlement.compress(transfers);
            long[] actual = new long[7];
            for (var transfer : compressed) {
                actual[Integer.parseInt(transfer.debtor().substring(1))] -= transfer.amount();
                actual[Integer.parseInt(transfer.creditor().substring(1))] += transfer.amount();
            }
            assertArrayEquals(oracle, actual);
            assertTrue(compressed.size() <= 6);
        }
    }

    @Test void dependencyOrderingRejectsCyclesAndMissingReferences() throws Exception {
        var repository = new ClearingHouse.Repository<ClearingHouse.Payment>();
        var a = payment("a", 10);
        var b = new ClearingHouse.Payment("b", "a", "b", a.amount, List.of("a"));
        repository.add(b);
        repository.add(a);
        assertEquals(List.of(a, b), ClearingHouse.DependencyPlan.order(repository));
        var cyclic = new ClearingHouse.Repository<ClearingHouse.Payment>();
        cyclic.add(new ClearingHouse.Payment("c", "a", "b", a.amount, List.of("d")));
        cyclic.add(new ClearingHouse.Payment("d", "a", "b", a.amount, List.of("c")));
        assertThrows(ClearingHouse.ClearingException.class, () -> ClearingHouse.DependencyPlan.order(cyclic));
        var missing = new ClearingHouse.Repository<ClearingHouse.Payment>();
        missing.add(b);
        assertThrows(ClearingHouse.ClearingException.class, () -> ClearingHouse.DependencyPlan.order(missing));
    }

    @Test void feeRoundingAndMoneyOverflowHaveDefinedBehavior() {
        var fees = new ClearingHouse.FeePolicy();
        assertEquals(5, fees.fee(1, ClearingHouse.Tier.STANDARD));
        assertEquals(500, fees.fee(1_000_000, ClearingHouse.Tier.STANDARD));
        assertEquals(250, fees.fee(1_000_000, ClearingHouse.Tier.GOLD));
        assertEquals(1005, fees.total(1000, ClearingHouse.Tier.STANDARD));
        assertThrows(IllegalArgumentException.class, () -> fees.fee(0, ClearingHouse.Tier.GOLD));
        var value = new ClearingHouse.Money(ClearingHouse.Currency.USD, 1);
        assertEquals("-0.01 USD", value.negate().format());
        assertEquals(2, value.plus(value).cents());
        assertThrows(ArithmeticException.class, () -> new ClearingHouse.Money(value.currency(), Long.MAX_VALUE).plus(value));
        assertEquals(ClearingHouse.Currency.KZT, ClearingHouse.Currency.parse(" kzt "));
    }

    @Test void ratesFollowPathsAndRejectDisconnectedOrOverflowingConversions() {
        var rates = new ClearingHouse.RateBook();
        rates.put(new ClearingHouse.Rate(ClearingHouse.Currency.USD, ClearingHouse.Currency.EUR, 9, 10));
        rates.put(new ClearingHouse.Rate(ClearingHouse.Currency.EUR, ClearingHouse.Currency.KZT, 500, 1));
        assertEquals(45000, rates.convert(new ClearingHouse.Money(ClearingHouse.Currency.USD, 100), ClearingHouse.Currency.KZT).cents());
        assertEquals(100, rates.convert(new ClearingHouse.Money(ClearingHouse.Currency.USD, 100), ClearingHouse.Currency.USD).cents());
        assertEquals(100, rates.convert(new ClearingHouse.Money(ClearingHouse.Currency.EUR, 90), ClearingHouse.Currency.USD).cents());
        assertThrows(IllegalArgumentException.class, () -> new ClearingHouse.RateBook().route(ClearingHouse.Currency.USD, ClearingHouse.Currency.EUR));
    }

    @Test void csvRoundTripsUnicodeQuotesAndEmptyFields() {
        List<String> fields = List.of("Алматы,банк", "a\"b", "", "line\nnext");
        assertEquals(fields, ClearingHouse.Csv.parse(ClearingHouse.Csv.encode(fields)));
        assertThrows(IllegalArgumentException.class, () -> ClearingHouse.Csv.parse("\"broken"));
    }

    @Test void analyticsAgreeWithBruteForceAndPrefixOracle() {
        long[] values = {8, 1, 3, 9, -2};
        assertEquals(6, ClearingHouse.Analytics.inversionCount(values));
        assertEquals(13, ClearingHouse.Analytics.maxWindow(values, 3));
        assertEquals(0, ClearingHouse.Analytics.maxWindow(values, 0));
        long[][] grid = {{1, 2, 3}, {4, 5, 6}};
        assertEquals(16, ClearingHouse.Analytics.rectangle(ClearingHouse.Analytics.prefix(grid), 0, 1, 2, 3));
        Arrays.sort(values);
        for (int key = -3; key <= 10; key++) {
            int expected = 0;
            while (expected < values.length && values[expected] < key) expected++;
            assertEquals(expected, ClearingHouse.Analytics.lowerBound(values, key));
        }
    }

    @Test void resourceCleanupPreservesPrimaryAndSuppressedOrder() {
        assertEquals(List.of("open:first", "open:second", "first+second", "close:second", "close:first",
                "caught:body", "suppressed:second", "suppressed:first", "finally"), ClearingHouse.cleanup(true, true));
        assertEquals(List.of("open:first", "open:second", "first+second", "close:second", "close:first", "finally"), ClearingHouse.cleanup(false, false));
        assertTrue(ClearingHouse.cleanup(false, true).contains("caught:second"));
    }

    @Test void configurationRepositoriesAndSimulationAreDeterministic() throws Exception {
        assertEquals(0, ClearingHouse.Config.parse("-3 7").size());
        assertEquals(180, ClearingHouse.Config.parse("999 7").size());
        assertEquals(24, ClearingHouse.Config.parse("bad").size());
        var repository = new ClearingHouse.Repository<ClearingHouse.Account>();
        var account = new ClearingHouse.BusinessAccount("x", ClearingHouse.Currency.USD, 10, 15);
        repository.add(account);
        assertEquals(15, account.limit());
        assertThrows(IllegalArgumentException.class, () -> repository.add(account));
        assertThrows(ClearingHouse.ClearingException.class, () -> repository.require("missing"));
        for (int count : new int[]{0, 1, 24, 180}) {
            var config = new ClearingHouse.Config(count, 17, true);
            assertEquals(ClearingHouse.run(config), ClearingHouse.run(config));
        }
        assertEquals(2166136261L, ClearingHouse.checksum(""));
        var originalIn = System.in;
        var originalOut = System.out;
        var output = new java.io.ByteArrayOutputStream();
        try (var stream = new java.io.PrintStream(output, true, java.nio.charset.StandardCharsets.UTF_8)) {
            System.setIn(new java.io.ByteArrayInputStream("4 13 1".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            System.setOut(stream);
            ClearingHouse.main(new String[0]);
        } finally {
            System.setIn(originalIn);
            System.setOut(originalOut);
        }
        assertEquals(ClearingHouse.run(new ClearingHouse.Config(4,13,true)), output.toString(java.nio.charset.StandardCharsets.UTF_8));
    }
}
