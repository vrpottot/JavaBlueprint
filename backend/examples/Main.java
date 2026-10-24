import java.util.Scanner;

public class Main {
    public static int classify(int value) {
        if (value > 0) {
            return 1;
        }
        return 0;
    }

    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int value = scanner.hasNextInt() ? scanner.nextInt() : 5;
        System.out.println(classify(value));
    }
}
