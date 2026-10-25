public class FinallyComment {
    public static void main(String[] args) {
        try {
            System.out.println("work");
        } finally {
            // A comment-only cleanup block is valid Java.
        }
        System.out.println("after");
    }
}
