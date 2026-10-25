# Скриншоты JavaScope для презентации

**[Скачать все 9 PNG одним архивом](presentation-screenshots.zip)** · **[Открыть приложение](https://javascope.193-233-246-241.sslip.io/)**

Размер каждого кадра — 1680 × 1050. Это снимки настоящего интерфейса с импортированными [BigODemo.java](../../backend/examples/BigODemo.java) и [BigODemoTest.java](../../backend/examples/BigODemoTest.java). Они не являются макетами. Дата, результаты API и реального JUnit сохранены в [evidence.json](evidence.json).

| Кадр | Что показывает |
| --- | --- |
| [O(1)](big-o-constant.png) | Одна примитивная арифметическая операция |
| [O(n)](big-o-linear.png) | Один проход до n |
| [O(log n)](big-o-logarithmic.png) | Деление счётчика на два |
| [O(n log n)](big-o-n-log-n.png) | Проход до n с логарифмическим внутренним циклом |
| [O(n²)](big-o-quadratic.png) | Перебор различных пар вложенными циклами |
| [Оптимизированный подсчёт O(1)](big-o-optimized.png) | Формула n(n−1)/2 с проверкой n < 2 |
| [Диагностика на графе](diagnostics-graph.png) | Оранжевый блок, текстовый значок, объяснение и рекомендация |
| [Диагностика в коде](diagnostics-code.png) | Та же проблема подсвечена в Monaco, есть переход к строке |
| [Компиляция и тесты](verification.png) | javac, 3 настоящих JUnit-теста и сравнение на вводе 16 |

Для слайда «до/после» используйте `big-o-quadratic.png` и `big-o-optimized.png`. Это две реализации одной задачи. Их равенство проверяется тестом на значениях от −2 до 128. Заявлять измеренное ускорение по этим кадрам нельзя: они показывают модель стоимости и результаты функциональной проверки.

Снимки можно повторить при запущенном локальном приложении и Docker:

```bash
npm --prefix backend run screenshots
```

Для опубликованной версии:

```bash
npm --prefix backend run screenshots -- --url https://javascope.193-233-246-241.sslip.io/ --output /tmp/javascope-live-screenshots
```

Нужен установленный Chromium Playwright (`cd backend` → `npx playwright install chromium`) либо путь `CHROME_PATH` к Chrome. Скрипт проверяет все шесть формул через API, совпадение выбранного метода в интерфейсе, подсветку, компиляцию, JUnit и сравнение. Архив в репозитории содержит зафиксированный набор PNG; при пересъёмке его нужно собрать заново.
