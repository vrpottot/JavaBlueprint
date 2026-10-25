import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class CostTrapsTest {
    @Test void growingBuilderAndCollectionHaveKnownWorkCounts() {
        for (int n : new int[]{0,1,2,4,8,16,32}) {
            assertEquals("a".repeat(n),CostTraps.aliasBuilder(n));
            assertEquals((long)n*n*(n+1)/2,CostTraps.growingHelper(n));
        }
    }

    @Test void nullSelectorsAndImplicitUnboxingExecuteFinallyBeforeThrowing() {
        List<String> trace=new ArrayList<>();
        assertThrows(NullPointerException.class,()->CostTraps.boxedSwitch(null,trace));
        assertEquals(List.of("finally"),trace);
        trace.clear();
        assertThrows(NullPointerException.class,()->CostTraps.unboxing(null,trace));
        assertEquals(List.of("finally"),trace);
    }
}
