import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

public class MainTest {
    @Test void positive() { assertEquals(1, Main.classify(3)); }
    @Test void negative() { assertEquals(0, Main.classify(-3)); }
    @Test void zero() { assertEquals(0, Main.classify(0)); }
}
