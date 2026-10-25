# Три контрольных монолита для Java Blueprints

Это независимый набор для проверки кейса AXENIX, а не примеры, подобранные под распознаваемые правила анализатора. Каждый основной `.java` содержит больше 1 000 строк обычного исходника и работает без сети, файлов, потоков и сторонних библиотек. Для каждого есть 15 настоящих JUnit 5 тестов. Классы имеют разные имена, поэтому файлы не нужно переименовывать в Main.java.

| Монолит | Строк | Задача | Пример stdin |
| --- | ---: | --- | --- |
| [ClearingHouse.java](clearing/ClearingHouse.java) | 1 018 | Клиринг: баланс, hold/capture/release, атомарные проводки, возвраты, риск-окно, взаимозачёт, зависимости, маршруты конвертации | `180 17 1` |
| [QueryForge.java](query/QueryForge.java) | 1 005 | Табличный движок: lexer/Pratt parser, вычисление выражений, фильтрация, проекция, индексы, joins, группировки, транзакции и CSV | `220 17` |
| [TransitGrid.java](transit/TransitGrid.java) | 1 001 | Транспорт: расписания, Дейкстра, Флойд, Диниц, минимальный разрез, SCC, MST, Fenwick, бронирование и возвраты | `48 17 1` |

QueryForge реализует собственное небольшое выражение запросов. Это не полный SQL: например, логика NULL здесь определена реализацией Expr и тестами; GROUP BY и JOIN доступны через Java API, а не через текстовую грамматику SELECT. Суммы и курсы ClearingHouse вымышлены; минуты TransitGrid — логические числа, без java.time.

В интерфейсе нажмите «Импорт», снимите «Добавить к текущему проекту», выберите сразу основной файл и соответствующий `*Test.java`. Выберите метод в «Метод схемы». В «Результат тестов» задайте stdin, нажмите Run, затем снова откройте «Результат тестов»: после запуска интерфейс переключается на консоль. Проверяйте отдельно компиляцию, строку `JUnit 5 (15 tests found)` и результат сравнения.

Для большого прогона нужен JDK 21, Node 22 и работающий Docker с образом runner из backend/README.md. Основной Java-код исполняется только в контейнере. JaCoCo подключается только к отдельному ручному прогону и не меняет обычный runner.

```bash
node backend/scripts/setup-jury-tools.mjs
npm --prefix backend run audit:jury
npm --prefix backend run audit:jury:browser -- --url https://javascope.193-233-246-241.sslip.io
npm --prefix backend run audit:jury:api -- --url https://javascope.193-233-246-241.sslip.io
npm --prefix backend run audit:jury:templates
npm --prefix backend run audit:jury:palette -- --url https://javascope.193-233-246-241.sslip.io
npm --prefix backend run audit:jury:png -- --url https://javascope.193-233-246-241.sslip.io
```

Для установленного Chrome можно задать `CHROME_PATH`. Альтернативные пути Docker/JDK задаются обычными `DOCKER_BIN`, `DOCKER_HOST`, `JAVA_BIN`. Крупные проверки не включены в короткий CI. `audit:jury` поддерживает `--case clearing|query|transit`, `--output` и `--coverage-tools`.

Контрактные проверки API, палитры, шаблонов и PNG **выходят с кодом 1 на версии 4334d84**: это воспроизведённые дефекты приложения, описанные в отчёте. Сами три монолита и их JUnit-тесты проходят. `CostTraps.java` и `FinallyComment.java` — маленькие воспроизводимые примеры дефектов, их следует импортировать отдельно.

Полная оценка, покрытия, ограничения и очередь исправлений находятся в [отчёте жюри](../../../docs/audits/jury-2026-10-25/README.md).
