# JavaBlueprint frontend

Live site: https://javascope.193-233-246-241.sslip.io. Frontend and backend deploy together on the VPS after a tested push to `main`; see [deployment instructions](../deploy/README.md).

The main workflow uses the Fastify backend. Start it first using [backend instructions](../backend/README.md), then run `npm ci` and `npm run dev` here with Node.js 22.12+.

Vite proxies `/api` to localhost:3001. Imports, AST block edits, source generation, static analysis and Java/JUnit verification use real API results. Select multiple `.java` files to import a project together with its tests. Program stdin is editable in the test panel. AI recommendations currently use static analysis; the model adapter is documented in [AI_CONTRACT.md](../backend/AI_CONTRACT.md).

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
