import java.nio.charset.StandardCharsets;
import java.util.Scanner;

/** Small reproducible presentation examples. n is the numeric input size. */
public class BigODemo {
    static long constant(int n) {
        return (long) n + 1;
    }

    static long linear(int n) {
        long sum = 0;
        for (int i = 0; i < n; i++) {
            sum += i;
        }
        return sum;
    }

    static int logarithmic(int n) {
        int steps = 0;
        while (n > 0) {
            n /= 2;
            steps++;
        }
        return steps;
    }

    static long quadratic(int n) {
        long pairs = 0;
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                pairs++;
            }
        }
        return pairs;
    }

    static long nLogN(int n) {
        long work = 0;
        for (int i = 0; i < n; i++) {
            for (int remaining = n; remaining > 0; remaining /= 2) {
                work++;
            }
        }
        return work;
    }

    static long pairsOptimized(int n) {
        if (n < 2) {
            return 0;
        }
        return (long) n * (n - 1) / 2;
    }

    public static void main(String[] args) {
        try (Scanner input = new Scanner(System.in, StandardCharsets.UTF_8)) {
            int n = input.hasNextInt() ? input.nextInt() : 16;
            n = Math.max(0, Math.min(128, n));
            System.out.println("n=" + n);
            System.out.println("constant=" + constant(n));
            System.out.println("linear=" + linear(n));
            System.out.println("logarithmic=" + logarithmic(n));
            System.out.println("quadratic=" + quadratic(n));
            System.out.println("nLogN=" + nLogN(n));
            System.out.println("optimized=" + pairsOptimized(n));
        }
    }
}
