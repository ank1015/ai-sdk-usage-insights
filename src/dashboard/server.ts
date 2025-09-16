import express, { type Express } from 'express';
import ejsMate from 'ejs-mate';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type DashboardServerOptions = {
  dbPath: string;
  port?: number;
  host?: string;
};

export type DashboardServerHandle = {
  app: Express;
  server: Server;
  host: string;
  port: number;
  url: string;
  dbPath: string;
  close: () => Promise<void>;
};

type ColumnType =
  | 'text'
  | 'multiline'
  | 'json'
  | 'datetime'
  | 'number'
  | 'boolean'
  | 'duration';

type ColumnSpec = {
  key: keyof LlmCallTableRow;
  label: string;
  description: string;
  type: ColumnType;
};

type LlmCallTableRow = {
  id: string;
  timestamp: string;
  model_id: string | null;
  tags_json: string | null;
  input_text: string | null;
  input_json: string | null;
  prompt_json: string | null;
  output_text: string | null;
  output_json: string | null;
  content_json: string | null;
  reasoning_text: string | null;
  reasoning_json: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  output_reasoning_tokens: number | null;
  request_tools_json: string | null;
  response_tools_json: string | null;
  tool_count: number | null;
  tool_names_json: string | null;
  parallel_tool_calls: number | null;
  temperature: number | null;
  top_p: number | null;
  max_output_tokens: number | null;
  finish_reason: string | null;
  latency_ms: number | null;
  warnings_json: string | null;
  request_id: string | null;
  response_id: string | null;
  headers_json: string | null;
  meta_json: string | null;
  error_json: string | null;
};

type DetailField = {
  key: string;
  label: string;
  description: string;
  displayValue: string;
  isPreformatted: boolean;
};

type ListEntry = {
  id: string;
  timestamp: string;
  formattedTimestamp: string;
  modelId: string | null;
  tags: string[];
  inputPreview: string | null;
  outputPreview: string | null;
  totalTokens: number | null;
  latencyMs: number | null;
};

const COLUMN_SPECS: ColumnSpec[] = [
  {
    key: 'id',
    label: 'Entry ID',
    description: 'Unique identifier generated for the logged call.',
    type: 'text',
  },
  {
    key: 'timestamp',
    label: 'Timestamp',
    description: 'When the middleware captured the call completion.',
    type: 'datetime',
  },
  {
    key: 'model_id',
    label: 'Model ID',
    description: 'Model identifier supplied with the request.',
    type: 'text',
  },
  {
    key: 'tags_json',
    label: 'Tags',
    description: 'Tags forwarded through middleware options.',
    type: 'json',
  },
  {
    key: 'input_text',
    label: 'Input Text',
    description: 'Human-readable prompt that was sent to the provider.',
    type: 'multiline',
  },
  {
    key: 'input_json',
    label: 'Input JSON',
    description: 'Raw request payload captured by the middleware.',
    type: 'json',
  },
  {
    key: 'prompt_json',
    label: 'Prompt Structure',
    description: 'Structured prompt/messages supplied in the request.',
    type: 'json',
  },
  {
    key: 'output_text',
    label: 'Output Text',
    description: 'Primary textual output returned by the model.',
    type: 'multiline',
  },
  {
    key: 'output_json',
    label: 'Output JSON',
    description: 'Complete response body from the provider.',
    type: 'json',
  },
  {
    key: 'content_json',
    label: 'Content JSON',
    description: 'Structured content array provided by the SDK.',
    type: 'json',
  },
  {
    key: 'reasoning_text',
    label: 'Reasoning Text',
    description: 'Extracted reasoning segments returned by the model.',
    type: 'multiline',
  },
  {
    key: 'reasoning_json',
    label: 'Reasoning JSON',
    description: 'Structured reasoning payload captured from the SDK.',
    type: 'json',
  },
  {
    key: 'input_tokens',
    label: 'Input Tokens',
    description: 'Token count consumed to send the prompt.',
    type: 'number',
  },
  {
    key: 'output_tokens',
    label: 'Output Tokens',
    description: 'Token count produced in the response.',
    type: 'number',
  },
  {
    key: 'total_tokens',
    label: 'Total Tokens',
    description: 'Combined input and output token usage.',
    type: 'number',
  },
  {
    key: 'cached_input_tokens',
    label: 'Cached Input Tokens',
    description: 'Tokens served from cache or reused prompts.',
    type: 'number',
  },
  {
    key: 'reasoning_tokens',
    label: 'Reasoning Tokens',
    description: 'Reasoning tokens reported by the provider.',
    type: 'number',
  },
  {
    key: 'output_reasoning_tokens',
    label: 'Output Reasoning Tokens',
    description: 'Reasoning tokens counted within output usage.',
    type: 'number',
  },
  {
    key: 'request_tools_json',
    label: 'Requested Tools',
    description: 'Tools declared with the request payload.',
    type: 'json',
  },
  {
    key: 'response_tools_json',
    label: 'Tool Calls Returned',
    description: 'Tool call payloads the provider responded with.',
    type: 'json',
  },
  {
    key: 'tool_count',
    label: 'Tool Count',
    description: 'Total number of tool calls executed.',
    type: 'number',
  },
  {
    key: 'tool_names_json',
    label: 'Tool Names',
    description: 'Names of the tools referenced during the call.',
    type: 'json',
  },
  {
    key: 'parallel_tool_calls',
    label: 'Parallel Tool Calls',
    description: 'Whether tool calls executed in parallel.',
    type: 'boolean',
  },
  {
    key: 'temperature',
    label: 'Temperature',
    description: 'Temperature parameter supplied to the provider.',
    type: 'number',
  },
  {
    key: 'top_p',
    label: 'Top P',
    description: 'Top-p (nucleus) sampling parameter.',
    type: 'number',
  },
  {
    key: 'max_output_tokens',
    label: 'Max Output Tokens',
    description: 'Maximum output tokens allowed for the call.',
    type: 'number',
  },
  {
    key: 'finish_reason',
    label: 'Finish Reason',
    description: 'Reason reported for finishing the response.',
    type: 'text',
  },
  {
    key: 'latency_ms',
    label: 'Latency',
    description: 'Time between request and response completion in milliseconds.',
    type: 'duration',
  },
  {
    key: 'warnings_json',
    label: 'Warnings',
    description: 'Warnings captured alongside the response.',
    type: 'json',
  },
  {
    key: 'request_id',
    label: 'Request ID',
    description: 'Upstream request identifier when provided.',
    type: 'text',
  },
  {
    key: 'response_id',
    label: 'Response ID',
    description: 'Upstream response identifier when provided.',
    type: 'text',
  },
  {
    key: 'headers_json',
    label: 'Response Headers',
    description: 'Captured response headers from the provider.',
    type: 'json',
  },
  {
    key: 'meta_json',
    label: 'Provider Metadata',
    description: 'Additional metadata forwarded by the provider.',
    type: 'json',
  },
  {
    key: 'error_json',
    label: 'Error',
    description: 'Error payload stored when the call failed.',
    type: 'json',
  },
];

export async function startDashboardServer(options: DashboardServerOptions): Promise<DashboardServerHandle> {
  const { dbPath, port = 4545, host = '127.0.0.1' } = options;
  if (!dbPath) {
    throw new Error('A path to the SQLite database must be provided.');
  }

  const absoluteDbPath = path.resolve(dbPath);
  if (!fs.existsSync(absoluteDbPath)) {
    throw new Error(`No SQLite database found at "${absoluteDbPath}"`);
  }

  const db = new Database(absoluteDbPath, { readonly: true, fileMustExist: true });

  const app = express();
  app.engine('ejs', ejsMate as any);
  app.set('view engine', 'ejs');
  app.set('views', resolveViewsDirectory());

  app.locals.formatDateTime = formatDateTime;

  const listStatement = db.prepare(
    'SELECT id, timestamp, model_id, tags_json, input_text, output_text, total_tokens, latency_ms FROM llm_calls ORDER BY datetime(timestamp) DESC'
  );
  const detailStatement = db.prepare(
    'SELECT * FROM llm_calls WHERE id = ?'
  );

  app.get('/', (_req, res) => {
    const rows = listStatement.all() as LlmCallTableRow[];
    const entries: ListEntry[] = rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      formattedTimestamp: formatDateTime(row.timestamp),
      modelId: row.model_id ?? null,
      tags: (safeParseJson(row.tags_json) as string[] | null) ?? [],
      inputPreview: row.input_text ? truncate(row.input_text, 140) : null,
      outputPreview: row.output_text ? truncate(row.output_text, 140) : null,
      totalTokens: row.total_tokens ?? null,
      latencyMs: row.latency_ms ?? null,
    }));

    res.render('index', { entries });
  });

  app.get('/entries/:id', (req, res) => {
    const id = req.params.id;
    const row = detailStatement.get(id) as LlmCallTableRow | undefined;
    if (!row) {
      res.status(404).render('not-found', { id });
      return;
    }

    const detailFields: DetailField[] = COLUMN_SPECS.map((spec) => {
      const raw = row[spec.key];
      const { displayValue, isPreformatted } = formatFieldValue(raw, spec.type);
      return {
        key: spec.key,
        label: spec.label,
        description: spec.description,
        displayValue,
        isPreformatted,
      };
    });

    res.render('detail', {
      id: row.id,
      detailFields,
      timestamp: formatDateTime(row.timestamp),
    });
  });

  let server: Server;
  try {
    server = await listenAsync(app, host, port);
  } catch (err) {
    db.close();
    throw err;
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;

    await new Promise<void>((resolve, reject) => {
      server.close((maybeError?: Error) => {
        if (maybeError) {
          closed = false;
          reject(maybeError);
          return;
        }
        try {
          db.close();
        } catch (dbError) {
          reject(dbError as Error);
          return;
        }
        resolve();
      });
    });
  };

  server.on('close', () => {
    if (!closed) {
      closed = true;
      try {
        db.close();
      } catch {
        // ignore close errors after shutdown
      }
    }
  });

  const address = server.address();
  const addressInfo = typeof address === 'object' && address !== null ? (address as AddressInfo) : undefined;
  const actualPort = addressInfo?.port ?? port;
  const bindingHost = addressInfo?.address ?? host;
  const publicHost = normaliseHostForUrl(bindingHost);
  const url = `http://${formatHostnameForUrl(publicHost)}:${actualPort}`;

  return {
    app,
    server,
    host: bindingHost,
    port: actualPort,
    url,
    dbPath: absoluteDbPath,
    close,
  };
}


function normaliseHostForUrl(host: string): string {
  if (!host || host === '0.0.0.0' || host === '::') {
    return '127.0.0.1';
  }
  return host;
}

function formatHostnameForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

async function listenAsync(app: Express, host: string, port: number): Promise<Server> {
  return await new Promise<Server>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      server.off('error', handleError);
      resolve(server);
    });

    function handleError(error: Error) {
      server.off('error', handleError);
      reject(error);
    }

    server.once('error', handleError);
  });
}


function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1)}\u2026`;
}

function safeParseJson(value: string | null): unknown {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function formatFieldValue(value: unknown, type: ColumnType): { displayValue: string; isPreformatted: boolean } {
  if (value == null) return { displayValue: '—', isPreformatted: false };

  switch (type) {
    case 'datetime':
      return { displayValue: formatDateTime(String(value)), isPreformatted: false };
    case 'json': {
      const parsed = typeof value === 'string' ? safeParseJson(value) : value;
      return {
        displayValue: JSON.stringify(parsed, null, 2),
        isPreformatted: true,
      };
    }
    case 'multiline':
      return { displayValue: String(value), isPreformatted: true };
    case 'boolean': {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(numeric)) {
        return { displayValue: String(value), isPreformatted: false };
      }
      return { displayValue: numeric ? 'Yes' : 'No', isPreformatted: false };
    }
    case 'duration':
      return { displayValue: `${value} ms`, isPreformatted: false };
    case 'number':
      return { displayValue: String(value), isPreformatted: false };
    case 'text':
    default:
      return { displayValue: String(value), isPreformatted: false };
  }
}

function resolveViewsDirectory(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(currentDir, '../..', 'views');
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  throw new Error('Unable to locate the views directory for the dashboard.');
}
