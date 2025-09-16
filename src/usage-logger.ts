import type {
    LanguageModelV2Middleware,
    LanguageModelV2CallOptions,
    LanguageModelV2StreamPart,
  } from '@ai-sdk/provider';

import type { LoggerOptions, LLMCallRow, SaveFn } from './types.js';
import { createSqliteHandle } from './db.js';
import util from 'util'

/* -------------------------- helpers: storage builder ------------------------- */
function buildSaver(options: LoggerOptions): { save: SaveFn; targetPath: string;} {
    const sqlite = createSqliteHandle(
      options.dirPath,
      options.fileName ?? 'llm-usage.db',
      options.sqliteWAL ?? true
    );
    return { save: sqlite.save, targetPath: sqlite.dbPath };
}


/* ------------------------------ helpers: tags -------------------------------- */
function extractTags(params: any): string[] | undefined {
  // Per-request metadata: pass via providerOptions at callsite
  // e.g., providerOptions: { usageLogger: { tags: ['qbr', 'analysis'] } }
  const opt = params?.providerOptions?.usageLogger ?? params?.providerMetadata?.usageLogger;
  if (!opt?.tags) return;
  return Array.isArray(opt.tags) ? opt.tags : [String(opt.tags)];
}

/* -------------------------- helpers: normalize usage ------------------------- */
function normUsage(u: any, bodyUsage?: any) {
  // camelCase or snake_case sources
  const inputTokens =
    u?.inputTokens ?? u?.promptTokens ?? bodyUsage?.input_tokens ?? null;

  const outputTokens =
    u?.outputTokens ?? u?.completionTokens ?? bodyUsage?.output_tokens ?? null;

  const totalTokens =
    u?.totalTokens ?? bodyUsage?.total_tokens ??
    (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null);

  const cachedInputTokens =
    u?.cachedInputTokens ??
    bodyUsage?.input_tokens_details?.cached_tokens ??
    null;

  // reasoning tokens (often on output side)
  const reasoningTokens =
    u?.reasoningTokens ?? null;

  const outputReasoningTokens =
    bodyUsage?.output_tokens_details?.reasoning_tokens ??
    u?.reasoningTokens ??
    null;

  return { inputTokens, outputTokens, totalTokens, cachedInputTokens, reasoningTokens, outputReasoningTokens };
}

/* -------------------------- helpers: input collation ------------------------- */
function collapseInputTextFromPromptArray(promptArr: any[]): string {
  return promptArr
    .map((m: any) => {
      const role = (m.role || 'message').toUpperCase();
      const content = Array.isArray(m.content)
        ? m.content.map((c: any) => c?.text ?? JSON.stringify(c)).join(' ')
        : (m.content ?? '');
      return `[${role}] ${content}`;
    })
    .join('\n');
}

function collapseInputText(params: any, requestBody?: any): string | undefined {
  // 1) params.prompt can be array of messages
  if (Array.isArray(params?.prompt)) {
    return `${collapseInputTextFromPromptArray(params.prompt)}`;
  }
  // 2) nonstandard messages key
  if (Array.isArray(params?.messages)) {
    const sys = params?.system ? `\n[SYSTEM]\n${params.system}\n` : '';
    const msgs = collapseInputTextFromPromptArray(params.messages);
    return `${sys}${msgs}`;
  }
  // 3) classic prompt string
  if (typeof params?.prompt === 'string') {
    const sys = params?.system ? `\n[SYSTEM]\n${params.system}\n` : '';
    return `${sys}[PROMPT]\n${params.prompt}`;
  }
  // 4) fall back to request.body.input if present
  const input = requestBody?.input;
  if (Array.isArray(input)) {
    const msgs = input
      .map((m: any) => `[${(m.role || 'message').toUpperCase()}] ${JSON.stringify(m.content)}`)
      .join('\n');
    return msgs;
  }
  return undefined;
}


/* ------------------------- helpers: output extraction ------------------------ */
function extractTextFromResult(result: any): string | undefined {
  // Prefer top-level text when present
  if (typeof result?.text === 'string' && result.text.length > 0) return result.text;

  // Fall back to result.content (array of { type: 'text' | 'reasoning', text })
  if (Array.isArray(result?.content)) {
    const textParts = result.content
      .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text);
    if (textParts.length) return textParts.join('');
  }
  return undefined;
}

function extractTextFromResponseBody(body: any): { text?: string; reasoningText?: string } {
  if (!body) return {};
  // OpenAI Responses API style: body.output[] -> message.content[] -> { type: 'output_text', text }

  const outputs = body.choices[0].message
  const text = outputs.content
  const reasoningText = outputs.reasoning_content
  return { text, reasoningText };
}

/* ------------------------- helpers: tools extraction ------------------------- */
function extractToolMeta(params: any, result: any, body: any) {
  const requestTools = params?.tools ?? result?.request?.body?.tools;
  const responseTools = body?.tools; // if provider echoes tools; some embed tool calls in messages
  const toolNames: string[] = Array.isArray(requestTools)
    ? requestTools.map((t: any) => t?.name).filter(Boolean)
    : [];

  // toolCount is best-effort; fall back to defined tools
  let toolCount: number | null = null;
  // If response includes explicit tool call records somewhere, you can parse here.
  if (Array.isArray(responseTools)) toolCount = responseTools.length;
  else if (Array.isArray(requestTools)) toolCount = requestTools.length;

  const parallelToolCalls =
    typeof body?.parallel_tool_calls === 'boolean'
      ? body.parallel_tool_calls
      : null;

  return {
    requestToolsJson: requestTools ?? null,
    responseToolsJson: responseTools ?? null,
    toolNames: toolNames.length ? toolNames : null,
    toolCount,
    parallelToolCalls,
  };
}

/* --------------------------- helpers: param picking -------------------------- */
function pickNumericParams(params: any, body: any) {
  let temperature =
    params?.temperature ??
    body?.temperature ??
    (typeof body?.text === 'object' && body?.temperature) ??
    null;
  
  // Ensure temperature is a number or null, not boolean
  if (typeof temperature === 'boolean') {
    temperature = null;
  }
  
  const topP = params?.topP ?? body?.top_p ?? null;
  const maxOutputTokens = params?.maxOutputTokens ?? body?.max_output_tokens ?? null;
  return { temperature, topP, maxOutputTokens };
}




export function createUsageLoggerMiddleware(options: LoggerOptions): LanguageModelV2Middleware {

  const { save } = buildSaver(options);
  return {

    async wrapGenerate({ doGenerate, params }) {
      const started = Date.now();
      const tags = extractTags(params);

      try {
        const result: any = await doGenerate();
        const body = result?.response?.body;
        const bodyUsage = body?.usage;

        // INPUT
        const inputText = collapseInputText(params, result?.request?.body);
        const promptJson = params?.prompt ?? null;
        const inputJson = result?.request?.body ?? result?.request ?? params;

        // OUTPUT
        let outputText = extractTextFromResult(result);
        let reasoningText: string | undefined;
        // if (!outputText) {
          const { text: fallbackText, reasoningText: rt } = extractTextFromResponseBody(body);
          outputText = outputText ?? fallbackText ;
          reasoningText = rt;
        // }
        const contentJson = result?.content ?? null;

        // USAGE
        const usage = normUsage(result?.usage, bodyUsage);

        // TOOLS
        const tools = extractToolMeta(params, result, body);

        // PARAMS
        const paramsPicked = pickNumericParams(params, body);

        const row: LLMCallRow = {
          timestamp: new Date(),
          modelId: result.request.body.model ?? (result as any)?.response?.modelId ?? null,
          tags,

          inputText,
          inputJson,
          promptJson,

          outputText: outputText ?? null,
          outputJson: body ?? null,
          contentJson,
          reasoningText: reasoningText ?? null,
          reasoningJson: Array.isArray(result?.content)
            ? result.content.filter((c: any) => c?.type === 'reasoning') : null,

          ...usage,

          requestToolsJson: tools.requestToolsJson,
          responseToolsJson: tools.responseToolsJson,
          toolCount: tools.toolCount,
          toolNames: tools.toolNames,
          parallelToolCalls: tools.parallelToolCalls,

          temperature: paramsPicked.temperature,
          topP: paramsPicked.topP,
          maxOutputTokens: paramsPicked.maxOutputTokens,

          finishReason: result?.finishReason ?? null,
          latencyMs: Date.now() - started,
          warnings: result?.warnings ?? null,
          requestId:
            result?.request?.id ??
            result?.response?.headers?.['x-request-id'] ??
            null,
          responseId: result?.response?.id ?? null,
          headersJson: result?.response?.headers ?? null,
          meta: result?.providerMetadata ?? null,
          error: null,
        };

        await save(row);
        return result;


      } catch (err: any) {
        const row: LLMCallRow = {
          timestamp: new Date(),
          modelId: (params as any)?.modelId,
          tags: extractTags(params),
          inputText: collapseInputText(params),
          inputJson: params,
          promptJson: params?.prompt ?? null,

          outputText: null,
          outputJson: null,
          contentJson: null,
          reasoningText: null,
          reasoningJson: null,

          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          cachedInputTokens: null,
          reasoningTokens: null,
          outputReasoningTokens: null,

          requestToolsJson: params?.tools ?? null,
          responseToolsJson: null,
          toolCount: null,
          toolNames: Array.isArray(params?.tools) ? params.tools.map((t: any) => t?.name).filter(Boolean) : null,
          parallelToolCalls: null,

          temperature: params?.temperature ?? null,
          topP: params?.topP ?? null,
          maxOutputTokens: params?.maxOutputTokens ?? null,

          finishReason: 'error',
          latencyMs: null,
          warnings: null,
          requestId: null,
          responseId: null,
          headersJson: null,
          meta: null,
          error: { message: String(err?.message ?? err), stack: err?.stack },
        };
        await save(row);
        throw err
      }
    },


    async wrapStream({ doStream, params }) {
      const started = Date.now();
      const tags = extractTags(params);
      const { stream, ...rest }: any = await doStream();

      const inputText = collapseInputText(params, rest?.request?.body);
      const promptJson = params?.prompt ?? null;

      let fullText = '';
      let reasoningText: string | undefined;

      const transformStream = new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
        transform(chunk, controller) {
          if (chunk?.type === 'text-delta') {
            fullText += chunk.delta;
          }
          if (chunk?.type === 'reasoning-delta' && typeof (chunk as any).delta === 'string') {
            reasoningText = (reasoningText ?? '') + (chunk as any).delta;
          }
          if (chunk?.type === 'finish') {
            const body = (rest as any)?.response?.body;
            const bodyUsage = (chunk as any)?.usage ?? body?.usage;
            const usage = normUsage((chunk as any)?.usage, bodyUsage);

            const tools = extractToolMeta(params, rest, body);
            const paramsPicked = pickNumericParams(params, body);

            const row: LLMCallRow = {
              timestamp: new Date(),
              modelId:(rest as any)?.request?.body.model ?? body?.model ?? null,
              tags,

              inputText,
              inputJson: (rest as any)?.request?.body ?? (rest as any)?.request ?? params,
              promptJson,

              outputText: fullText || null,
              outputJson: body ?? null,
              contentJson: null,
              reasoningText: reasoningText ?? null,
              reasoningJson: null,

              ...usage,

              requestToolsJson: tools.requestToolsJson,
              responseToolsJson: tools.responseToolsJson,
              toolCount: tools.toolCount,
              toolNames: tools.toolNames,
              parallelToolCalls: tools.parallelToolCalls,

              temperature: paramsPicked.temperature,
              topP: paramsPicked.topP,
              maxOutputTokens: paramsPicked.maxOutputTokens,

              finishReason: (chunk as any)?.finishReason ?? null,
              latencyMs: Date.now() - started,
              warnings: (rest as any)?.warnings ?? null,
              requestId:
                (rest as any)?.request?.id ??
                (rest as any)?.response?.headers?.['x-request-id'] ??
                null,
              responseId: (rest as any)?.response?.id ?? null,
              headersJson: (rest as any)?.response?.headers ?? null,
              meta: (rest as any)?.providerMetadata ?? null,
              error: null,
            };

            // don't block stream - use setImmediate to ensure it runs
            setImmediate(async () => {
              try {
                await save(row);
              } catch (err) {
                console.error('Failed to save stream data to DB:', err);
              }
            });
          }
          controller.enqueue(chunk);
        },
      });

      return { stream: stream.pipeThrough(transformStream), ...rest };
    },

  }
}