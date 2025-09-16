// src/storage/sqlite-storage.ts
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { LLMCallRow, SaveFn } from './types.js';

export type SqliteHandle = {
  save: SaveFn;
  dbPath: string;
  db: Database.Database;
};


function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}


const DDL = `
CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  timestamp TEXT NOT NULL,

  model_id TEXT,
  tags_json TEXT,

  -- input
  input_text TEXT,
  input_json TEXT,
  prompt_json TEXT,

  -- output
  output_text TEXT,
  output_json TEXT,
  content_json TEXT,
  reasoning_text TEXT,
  reasoning_json TEXT,

  -- usage
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cached_input_tokens INTEGER,
  reasoning_tokens INTEGER,
  output_reasoning_tokens INTEGER,

  -- tools
  request_tools_json TEXT,
  response_tools_json TEXT,
  tool_count INTEGER,
  tool_names_json TEXT,
  parallel_tool_calls INTEGER,

  -- params
  temperature REAL,
  top_p REAL,
  max_output_tokens INTEGER,

  -- meta/misc
  finish_reason TEXT,
  latency_ms INTEGER,
  warnings_json TEXT,
  request_id TEXT,
  response_id TEXT,
  headers_json TEXT,
  meta_json TEXT,
  error_json TEXT
);

CREATE INDEX IF NOT EXISTS llm_calls_time_idx  ON llm_calls (timestamp DESC);
CREATE INDEX IF NOT EXISTS llm_calls_model_idx ON llm_calls (model_id, timestamp DESC);
`;

export function createSqliteHandle(dirPath: string, fileName = 'llm-usage.db', enableWAL = true): SqliteHandle {
  ensureDir(dirPath);
  const dbPath = path.join(dirPath, fileName);
  const db = new Database(dbPath);
  if (enableWAL) db.pragma('journal_mode = WAL');
  db.exec(DDL);


  const columns = [
    'timestamp', 'model_id', 'tags_json',
    'input_text', 'input_json', 'prompt_json',
    'output_text', 'output_json', 'content_json', 'reasoning_text', 'reasoning_json',
    'input_tokens', 'output_tokens', 'total_tokens', 'cached_input_tokens', 'reasoning_tokens', 'output_reasoning_tokens',
    'request_tools_json', 'response_tools_json', 'tool_count', 'tool_names_json', 'parallel_tool_calls',
    'temperature', 'top_p', 'max_output_tokens',
    'finish_reason', 'latency_ms', 'warnings_json', 'request_id', 'response_id', 'headers_json', 'meta_json', 'error_json',
  ];
  const placeholders = columns.map(() => '?').join(',');
  const insert = db.prepare(
    `INSERT INTO llm_calls (${columns.join(',')}) VALUES (${placeholders})`
  );

  const safeJsonStringify = (value: any): string | null => {
    if (value == null || value === undefined) return null;
    try {
      return JSON.stringify(value);
    } catch (err) {
      process.emitWarning(
        err instanceof Error ? err.message : String(err),
        {
          code: 'LLM_USAGE_JSON_ENCODE',
          detail: 'Falling back to string representation while persisting usage row.',
        }
      );
      return String(value);
    }
  };

  const ensureSqliteCompatible = (value: any): string | number | bigint | Buffer | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || Buffer.isBuffer(value)) {
      return value;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0; // Convert boolean to number
    }
    // For any other type, convert to string
    return String(value);
  };

  const save: SaveFn = async (row) => {
    const values = [
      ensureSqliteCompatible(row.timestamp.toISOString()),
      ensureSqliteCompatible(row.modelId),
      ensureSqliteCompatible(row.tags ? safeJsonStringify(row.tags) : null),

      ensureSqliteCompatible(row.inputText),
      ensureSqliteCompatible(safeJsonStringify(row.inputJson)),
      ensureSqliteCompatible(safeJsonStringify(row.promptJson)),

      ensureSqliteCompatible(row.outputText),
      ensureSqliteCompatible(safeJsonStringify(row.outputJson)),
      ensureSqliteCompatible(safeJsonStringify(row.contentJson)),
      ensureSqliteCompatible(row.reasoningText),
      ensureSqliteCompatible(safeJsonStringify(row.reasoningJson)),

      ensureSqliteCompatible(row.inputTokens),
      ensureSqliteCompatible(row.outputTokens),
      ensureSqliteCompatible(row.totalTokens),
      ensureSqliteCompatible(row.cachedInputTokens),
      ensureSqliteCompatible(row.reasoningTokens),
      ensureSqliteCompatible(row.outputReasoningTokens),

      ensureSqliteCompatible(safeJsonStringify(row.requestToolsJson)),
      ensureSqliteCompatible(safeJsonStringify(row.responseToolsJson)),
      ensureSqliteCompatible(row.toolCount),
      ensureSqliteCompatible(row.toolNames ? safeJsonStringify(row.toolNames) : null),
      ensureSqliteCompatible(row.parallelToolCalls == null ? null : (row.parallelToolCalls ? 1 : 0)),

      ensureSqliteCompatible(row.temperature),
      ensureSqliteCompatible(row.topP),
      ensureSqliteCompatible(row.maxOutputTokens),

      ensureSqliteCompatible(row.finishReason),
      ensureSqliteCompatible(row.latencyMs),
      ensureSqliteCompatible(row.warnings ? safeJsonStringify(row.warnings) : null),
      ensureSqliteCompatible(row.requestId),
      ensureSqliteCompatible(row.responseId),
      ensureSqliteCompatible(row.headersJson ? safeJsonStringify(row.headersJson) : null),
      ensureSqliteCompatible(row.meta ? safeJsonStringify(row.meta) : null),
      ensureSqliteCompatible(row.error ? safeJsonStringify(row.error) : null)
    ];

    insert.run(...values);
  };

  return { save, dbPath, db };
}
