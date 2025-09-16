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

  const save: SaveFn = async (row) => {
    insert.run(
      row.timestamp.toISOString(),
      row.modelId ?? null,
      row.tags ? JSON.stringify(row.tags) : null,

      row.inputText ?? null,
      row.inputJson != null ? JSON.stringify(row.inputJson) : null,
      row.promptJson != null ? JSON.stringify(row.promptJson) : null,

      row.outputText ?? null,
      row.outputJson != null ? JSON.stringify(row.outputJson) : null,
      row.contentJson != null ? JSON.stringify(row.contentJson) : null,
      row.reasoningText ?? null,
      row.reasoningJson != null ? JSON.stringify(row.reasoningJson) : null,

      row.inputTokens ?? null,
      row.outputTokens ?? null,
      row.totalTokens ?? null,
      row.cachedInputTokens ?? null,
      row.reasoningTokens ?? null,
      row.outputReasoningTokens ?? null,

      row.requestToolsJson != null ? JSON.stringify(row.requestToolsJson) : null,
      row.responseToolsJson != null ? JSON.stringify(row.responseToolsJson) : null,
      row.toolCount ?? null,
      row.toolNames ? JSON.stringify(row.toolNames) : null,
      row.parallelToolCalls == null ? null : (row.parallelToolCalls ? 1 : 0),

      row.temperature ?? null,
      row.topP ?? null,
      row.maxOutputTokens ?? null,

      row.finishReason ?? null,
      row.latencyMs ?? null,
      row.warnings ? JSON.stringify(row.warnings) : null,
      row.requestId ?? null,
      row.responseId ?? null,
      row.headersJson ? JSON.stringify(row.headersJson) : null,
      row.meta ? JSON.stringify(row.meta) : null,
      row.error ? JSON.stringify(row.error) : null
    );
  };

  return { save, dbPath, db };
}
