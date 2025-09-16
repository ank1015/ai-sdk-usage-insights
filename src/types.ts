export type TokenUsageNormalized = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedInputTokens?: number | null;     // aka cached_tokens (prompt cache)
  reasoningTokens?: number | null;       // from result.usage.reasoningTokens
};

export type LLMCallRow = TokenUsageNormalized & {
  timestamp: Date;
  modelId?: string | null;
  tags?: string[] | null;

  // Input
  inputText?: string | null;       // collated human-readable view of final input

  // Output
  contentJson?: any | null;        // result.content array (reasoning + text etc.)

  // Tools
  requestToolsJson?: any | null;   // params.tools / request.body.tools

  // Params (common)
  temperature?: number | null;
  topP?: number | null;
  maxOutputTokens?: number | null;

  // Misc
  finishReason?: string | null;
  latencyMs?: number | null;
  warnings?: any[] | null;
  requestId?: string | null;       // typically from response.headers['x-request-id']
  responseId?: string | null;      // result.response.id
  headersJson?: any | null;        // response.headers
  meta?: Record<string, any> | null;
  error?: { message: string; stack?: string } | null;
};

export type SaveFn = (row: LLMCallRow) => Promise<void>;

export type LoggerOptions = {
  dirPath: string;                 // directory where the file lives
  fileName?: string;               // defaults: sqlite -> llm-usage.db; json -> llm-usage.json
  sqliteWAL?: boolean;             // default true
};
