# JavaBlueprint frontend

Live site: https://javascope.193-233-246-241.sslip.io. Frontend and backend deploy together on the VPS after a tested push to `main`; see [deployment instructions](../deploy/README.md).

The main workflow uses the Fastify backend. Start it first using [backend instructions](../backend/README.md), then run `npm ci` and `npm run dev` here with Node.js 22.12+.

Vite proxies `/api` to localhost:3001. Imports, AST block edits, source generation, static analysis and Java/JUnit verification use real API results. Select multiple `.java` files to import a project together with its tests. Program stdin is editable in the test panel. **Чат с ИИ** uses the server's configured model; the **Сводка** panel displays analysis. Verified model proposals are documented in [AI_CONTRACT.md](../backend/AI_CONTRACT.md). No AI key is needed in the browser.

Click or drag **Метод** from the palette to add a method. Choose a class/file, enter its signature and body, optionally check syntax, then save. Empty classes and nested named types are supported. Double-click a method to edit; its context menu copies or deletes the declaration. Java and the graph update together, and the canvas focuses the new method. Syntax checks leave the project unchanged; **Run** performs actual compilation and JUnit verification. Signature changes do not automatically rewrite callers.

The explorer selects the Java file; **Метод** selects a method or constructor, with search by method/class name. The initial view focuses its entry at a readable scale. Pan with the mouse wheel and use the zoom buttons or **Вписать в экран** for the whole method. **Весь файл — обзор** is a map of the file, not a readable view of every statement at once. **Автораскладка** resets deliberate drags in the current scope. Context menu **Открыть Java-код** opens the selected node's current source line.

Loop blocks show their complete headers. Case statements accept full Java instructions, including semicolons. Invalid changes keep the edit dialog and show diagnostics; invalid source keeps the last successfully parsed graph with a visible notice. Exception/finally flow and opaque lambda/switch-expression internals have explicit limitations beside the method. AI suggestions are labeled and cannot overwrite AST metrics or complexity results.

The [stress-test audit](../docs/audits/2026-10-25/README.md) records failures found on a 1,192-line Java project, fixes, screenshots and remaining limits. With both projects' dependencies installed, run `npm --prefix ../backend run test:frontend` for the store/API regression check; browser checks are documented in the backend README.

## Vite tooling

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
