import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class FlowCasesTest {
    @Test
    void returnExpressionIsCapturedBeforeFinally() {
        List<String> trace = new ArrayList<>();
        assertEquals(1, FlowCases.snapshot(trace));
        assertEquals(List.of("try", "finally:9"), trace);
    }

    @Test
    void returnInFinallyOverridesOnlyItsBranch() {
        List<String> trace = new ArrayList<>();
        assertEquals(2, FlowCases.override(true, trace));
        assertEquals(List.of("try", "finally"), trace);
        trace.clear();
        assertEquals(1, FlowCases.override(false, trace));
        assertEquals(List.of("try", "finally"), trace);
    }

    @Test
    void nestedFinalizersRunInsideOut() {
        List<String> trace = new ArrayList<>();
        assertEquals(7, FlowCases.nested(trace));
        assertEquals(List.of("body", "inner", "outer"), trace);
    }

    @Test
    void breakAndContinueBothExecuteFinally() {
        List<String> trace = new ArrayList<>();
        assertEquals(1, FlowCases.loop(false, trace));
        assertEquals(List.of("finally:0", "after"), trace);
        trace.clear();
        assertEquals(3, FlowCases.loop(true, trace));
        assertEquals(List.of("finally:0", "finally:1", "finally:2", "after"), trace);
    }

    @Test
    void closeOrderAndTwoSuppressedFailuresPreservePrimary() {
        List<String> trace = new ArrayList<>();
        assertEquals("body", FlowCases.resources(0, true, true, trace));
        assertEquals(List.of("open:first", "open:second", "body:first+second", "close:second", "close:first",
                "catch:body", "suppressed:close:second", "suppressed:close:first", "finally"), trace);
    }

    @Test
    void failedSecondInitializerClosesOnlyFirstResource() {
        List<String> trace = new ArrayList<>();
        assertEquals("open:second", FlowCases.resources(2, false, false, trace));
        assertEquals(List.of("open:first", "open:second", "close:first", "catch:open:second", "finally"), trace);
        trace.clear();
        assertEquals("open:first", FlowCases.resources(1, false, false, trace));
        assertEquals(List.of("open:first", "catch:open:first", "finally"), trace);
    }

    @Test
    void closeFailureReplacesPendingReturn() {
        List<String> trace = new ArrayList<>();
        assertEquals(2, FlowCases.closeOverridesReturn(trace));
        assertEquals(List.of("open:one", "return:one", "close:one", "catch:close", "finally"), trace);
    }

    @Test
    void selfSuppressionIsDifferentFromOrdinarySuppression() {
        List<String> trace = new ArrayList<>();
        assertTrue(FlowCases.selfSuppression(trace));
        assertEquals(List.of("open:one", "body:one", "close:one", "self-suppression", "finally"), trace);
    }

    @Test
    void exceptionInFinallyReplacesPendingReturn() {
        List<String> trace = new ArrayList<>();
        assertEquals("winner", assertThrows(IOException.class, () -> FlowCases.finallyThrows(trace)).getMessage());
        assertEquals(List.of("return", "finally"), trace);
    }

    @Test
    void nullResourceDoesNotClose() throws IOException {
        List<String> trace = new ArrayList<>();
        FlowCases.nullResource(trace);
        assertEquals(List.of("null", "finally"), trace);
    }
}
