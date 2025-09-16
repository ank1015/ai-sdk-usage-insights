export type TokenUsageNormalized = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedInputTokens?: number | null;     // aka cached_tokens (prompt cache)
  reasoningTokens?: number | null;       // from result.usage.reasoningTokens
  outputReasoningTokens?: number | null; // from response.body.usage.output_tokens_details.reasoning_tokens
};

export type LLMCallRow = TokenUsageNormalized & {
  timestamp: Date;
  modelId?: string | null;
  tags?: string[] | null;

  // Input
  inputText?: string | null;       // collated human-readable view of final input
  inputJson?: any | null;          // final request we saw (prefer request.body)
  promptJson?: any | null;         // params.prompt (messages array)

  // Output
  outputText?: string | null;      // final text (reconstructed for streams / tool flows)
  outputJson?: any | null;         // provider response body
  contentJson?: any | null;        // result.content array (reasoning + text etc.)
  reasoningText?: string | null;   // extracted natural-language reasoning if present
  reasoningJson?: any | null;      // full reasoning objects if available

  // Tools
  requestToolsJson?: any | null;   // params.tools / request.body.tools
  responseToolsJson?: any | null;  // response.body.tools / tool calls (if present)
  toolCount?: number | null;
  toolNames?: string[] | null;
  parallelToolCalls?: boolean | null;

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
