import type { LoggerOptions, LLMCallRow, SaveFn } from './types.js';
import { createSqliteHandle } from './db.js';

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


export function createUsageLoggerMiddleware(options: LoggerOptions) {

  const { save } = buildSaver(options);
  return {

    async wrapGenerate({ doGenerate, params, model }: { doGenerate: () => any, params: any, model: any }) {
      const started = Date.now();
      const tags = extractTags(params);


      try {
        const result: any = await doGenerate();

        const requestBody = (typeof result.request.body === 'string') ? JSON.parse(result.request.body) : result.request.body;

        const modelId = requestBody.model ?? model.modelId ?? result.response.modelId ?? null;

        const inputArray = requestBody.messages ?? requestBody.input ?? params.prompt ?? [];
        const inputText = inputArray.map((message: any) => JSON.stringify(message) ).join('\n');

        const contentMessages = result.content ?? [];
        const contentJson = contentMessages.map((message: any) => JSON.stringify(message)).join('\n');

        const inputTokens = result.usage.inputTokens;
        const outputTokens = result.usage.outputTokens;
        const totalTokens = result.usage.totalTokens;
        const cachedInputTokens = result.usage.cachedInputTokens;
        const reasoningTokens = result.usage.reasoningTokens;

        const row: LLMCallRow = {
          timestamp: new Date(),
          modelId: modelId ,
          tags,
          inputText,
          contentJson,
          inputTokens,
          outputTokens,
          totalTokens,
          cachedInputTokens,
          reasoningTokens,
          requestToolsJson: params.tools ?? null,
          temperature: params.temperature ?? null,
          topP: params.topP ?? null,
          maxOutputTokens: params.maxOutputTokens,

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
        const inputPrompt = params.prompt ?? [];
        const inputText = inputPrompt.map((message: any) => (message.role + '\n' + (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))).join('\n');

        const row: LLMCallRow = {
          timestamp: new Date(),
          modelId: model.modelId,
          tags: extractTags(params),
          inputText,

          contentJson: null,

          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          cachedInputTokens: null,
          reasoningTokens: null,

          requestToolsJson: params?.tools ?? null,

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


    async wrapStream({ doStream, params, model }: { doStream: () => any, params: any, model: any }) {
      const started = Date.now();
      const tags = extractTags(params);
      const { stream, request, response }: any = await doStream();


      let contentJson = '';
      let warnings: any[] | null = null;
      let error: any = null;

      const transformStream = new TransformStream<any>({
        transform(chunk, controller) {

          if(chunk.type == 'reasoning-start'){
            contentJson += 'Reasoning' + '\n'
          }
          if(chunk.type == 'reasoning-delta'){
            contentJson += chunk.delta
          }
          if(chunk.type == 'reasoning-end'){
            contentJson += '\n'
          }

          if(chunk.type == 'text-start'){
            contentJson += 'Model Response' + '\n'
          }
          if(chunk.type == 'text-delta'){
            contentJson += chunk.delta
          }
          if(chunk.type == 'reasoning-end'){
            contentJson += '\n'
          }

          if(chunk.type == 'tool-input-start'){
            contentJson += 'Model Tool call' + '\n'
          }
          if(chunk.type == 'tool-input-delta'){
            contentJson += chunk.delta
          }
          if(chunk.type == 'tool-input-end'){
            contentJson += '\n'
          }

          if(chunk.type == 'stream-start'){
            warnings = chunk.warnings
          }
          if(chunk.type == 'error'){
            error = chunk.error
          }
          if (chunk?.type === 'finish') {
            const modelId = request.body.model ?? model.modelId ??  null;

            const inputArray = request.body.messages ?? request.body.input ?? params.prompt ?? []; []
            const inputText = inputArray.map((message: any) => JSON.stringify(message) ).join('\n');
    
            const inputTokens = chunk.usage.inputTokens ?? null;
            const outputTokens = chunk.usage.outputTokens ?? null;
            const totalTokens = chunk.usage.totalTokens ?? null;
            const cachedInputTokens = chunk.usage.cachedInputTokens ?? null;
            const reasoningTokens = chunk.usage.reasoningTokens ?? null;

            const row: LLMCallRow = {
              timestamp: new Date(),
              modelId: modelId,
              tags,
              inputText,
              contentJson: contentJson,
              inputTokens,
              outputTokens,
              totalTokens,
              cachedInputTokens,
              reasoningTokens,
              requestToolsJson: params.tools ?? null,

              temperature: params.temperature ?? null,
              topP: params.topP ?? null,
              maxOutputTokens: params.maxOutputTokens ?? null,

              finishReason: (chunk as any)?.finishReason ?? null,
              latencyMs: Date.now() - started,
              warnings: warnings,
              requestId: request?.id ?? response?.headers?.['x-request-id'] ?? null,
              responseId: response?.id ?? null,
              headersJson: response?.headers ?? null,
              meta: chunk.providerMetadata ?? null,
              error: error,
            };

            // don't block stream - use setImmediate to ensure it runs
            setImmediate(async () => {
              try {
                await save(row);
              } catch (err) {
                process.emitWarning(
                  err instanceof Error ? err.message : String(err),
                  {
                    code: 'LLM_USAGE_STREAM_SAVE_FAILURE',
                    detail: 'Unable to persist streaming usage log row.',
                  }
                );
              }
            });
          }
          controller.enqueue(chunk);
        },
      });

      return { stream: stream.pipeThrough(transformStream), request, response };
    },

  }
}
