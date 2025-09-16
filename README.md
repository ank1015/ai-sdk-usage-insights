# ai-sdk-usage-insights

A lightweight observability companion for the [AI SDK](https://sdk.vercel.ai) that records every model call to SQLite and ships with a dashboard for exploring captured prompts, outputs, token usage, and tool calls.

## Features

- 🔌 Drop-in middleware for the AI SDK to persist call metadata, usage, tool traces, and errors.
- 📊 Minimal, privacy-friendly dashboard that runs locally against the generated SQLite database.
- 🧾 Typed APIs so TypeScript projects get rich inference when accessing recorded rows.
- 🧰 CLI for launching the dashboard from any project that consumes the package.

## Installation

```sh
npm install ai-sdk-usage-insights
# or
pnpm add ai-sdk-usage-insights
```

## Usage

### 1. Register the middleware

```ts
import { createUsageLoggerMiddleware } from 'ai-sdk-usage-insights';

const usageMiddleware = createUsageLoggerMiddleware({
  dirPath: './.usage',
  fileName: 'ai-usage.db',
});

const client = createClient({
  middleware: [usageMiddleware],
});
```

Every model invocation stores a row in the configured database. The schema (see `llm_calls` table) includes the serialized request/response payloads and token accounting.

### 2. Launch the dashboard

You can start the dashboard via the CLI:

```sh
npx ai-sdk-usage dashboard ./.usage/ai-usage.db
```

By default the dashboard binds to `127.0.0.1:4545`. Use `--host` or `--port` to change the binding.

Programmatic usage is also available:

```ts
import { startDashboardServer } from 'ai-sdk-usage-insights';

const { url, close } = await startDashboardServer({
  dbPath: './.usage/ai-usage.db',
  port: 3000,
});

console.log(`Dashboard running at ${url}`);

// Later on…
await close();
```

## Development

```sh
npm install
npm run build
```

The dashboard templates live in `views/` and are served via EJS. When publishing, run `npm run build` (already wired up through the `prepublishOnly` hook).

## License

MIT © Usage Insights Contributors
