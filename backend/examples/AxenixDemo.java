package demo;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.io.IOException;

// 1 Язык и java.lang: пользовательские классы и интерфейсы, static, конструкторы, методы
interface DataProcessor {
    void process();
}

// 4 Исключения: пользовательские исключения через наследование
class ProcessingException extends Exception {
    public ProcessingException(String message) {
        super(message);
    }
}

public class AxenixDemo implements DataProcessor {
    // 1 Поля, static, примитивы и обёртки
    public static final String APP_NAME = "Axenix Demo";
    private int counter = 0;
    private Integer boxedCounter = Integer.valueOf(0);

    // 1 Конструктор
    public AxenixDemo() {
        this.counter = 1;
    }

    // 4 Исключения: throws
    public void riskyOperation(int value) throws ProcessingException {
        if (value < 0) {
            // 4 Исключения: throw
            throw new ProcessingException("Значение не может быть отрицательным: " + value);
        }
    }

    @Override
    public void process() {
        // 2 Консольный ввод-вывод: Scanner, StandardCharsets для работы с кириллицей
        Scanner scanner = new Scanner(System.in, StandardCharsets.UTF_8);

        // 1 Примитивы, массивы
        int[] numbers = new int[]{1, 2, 3, 4, 5};

        // 3 Коллекции java.util: List, Set, Map, ArrayList, HashSet, HashMap, List.of
        List<String> items = new ArrayList<>(List.of("Альфа", "Бета", "Гамма"));
        Set<Integer> uniqueSet = new HashSet<>(Set.of(10, 20, 30));
        Map<String, Integer> scoreMap = new HashMap<>(Map.of("Игрок 1", 100));

        // 3 Iterator, Collections, Arrays, Optional
        Collections.sort(items);
        Optional<String> firstItem = items.stream().findFirst();

        // 1 Циклы: foreach, while, do-while, break/continue
        for (String item : items) {
            if (item.isEmpty()) {
                continue;
            }
            // 2 Консольный ввод-вывод: System.out, printf, String.format
            System.out.printf("Элемент: %s%n", item);
        }

        // 1 Switch, арифметика, логика
        int mode = 2;
        switch (mode) {
            case 1:
                System.out.println("Режим 1");
                break;
            case 2:
                System.out.println("Режим 2 активирован");
                break;
            default:
                System.err.println("Неизвестный режим");
                break;
        }

        // 4 Исключения: try/catch/finally
        try {
            riskyOperation(counter);
            System.out.println("Успешное выполнение");
        } catch (ProcessingException e) {
            // 2 Консольный ввод-вывод: System.err
            System.err.println("Ошибка обработки: " + e.getMessage());
        } finally {
            System.out.println("Завершение блока try/catch");
        }
    }

    public static void main(String[] args) {
        AxenixDemo demo = new AxenixDemo();
        demo.process();
    }
}
