import java.util.ArrayList;
import java.util.List;

/** Minimal valid programs exposing unsound cost bounds in revision 4334d84. */
public final class CostTraps {
    private CostTraps() {}

    // n appends and n copies of lengths 1..n: Theta(n^2), currently reported O(n).
    static String aliasBuilder(int n) {
        StringBuilder first = new StringBuilder();
        StringBuilder alias = first;
        String result = "";
        for (int i = 0; i < n; i++) {
            first.append('a');
            result = alias.toString();
        }
        return result;
    }

    // The list grows by n on each outer step. Total visits = n*n*(n+1)/2.
    // Current model reports O(n^2), actual bound is Theta(n^3).
    static long growingHelper(int n) {
        List<Integer> values = new ArrayList<>();
        long visits = 0;
        for (int i = 0; i < n; i++) {
            append(values, n);
            for (int ignored : values) {
                visits++;
            }
        }
        return visits;
    }

    static void append(List<Integer> values, int n) {
        for (int i = 0; i < n; i++) {
            values.add(i);
        }
    }

    // Null selector throws NPE, after executing finally. The CFG misses that route.
    static int boxedSwitch(Integer value, List<String> trace) {
        try {
            return switch (value) {
                case 0 -> 0;
                default -> 1;
            };
        } finally {
            trace.add("finally");
        }
    }

    // Reading an Integer may unbox null before return and still execute finally.
    static int unboxing(Integer value, List<String> trace) {
        try {
            return value + 1;
        } finally {
            trace.add("finally");
        }
    }
}
