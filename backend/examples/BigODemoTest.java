import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class BigODemoTest {
    @Test void linearAndConstantUseKnownValues() {
        assertEquals(1, BigODemo.constant(0));
        assertEquals(17, BigODemo.constant(16));
        assertEquals(120, BigODemo.linear(16));
    }

    @Test void halvingHasKnownStepCounts() {
        assertEquals(0, BigODemo.logarithmic(0));
        assertEquals(1, BigODemo.logarithmic(1));
        assertEquals(5, BigODemo.logarithmic(16));
        assertEquals(80, BigODemo.nLogN(16));
    }

    @Test void constantTimeReplacementPreservesPairCountsOnBoundaryAndNormalInputs() {
        for (int n = -2; n <= 128; n++) {
            assertEquals(BigODemo.quadratic(n), BigODemo.pairsOptimized(n), "n=" + n);
        }
    }
}
