import { wrapLanguageModel, generateText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createUsageLoggerMiddleware } from '../dist/index.js';

const deepseek = createDeepSeek({
  apiKey: ''
});


const logger = createUsageLoggerMiddleware({
  dirPath: './.db',
  fileName: 'llm-usage.db'
});

const model = wrapLanguageModel({
    model: deepseek('deepseek-reasoner'),
    middleware: [logger], // keep toward the end so you see final params
});

const run = async () => {

    const result = await generateText({
        model,
        system: 'You are precise.',
        prompt: 'Explain the QBR in 9 bullets.',
        providerOptions: {
          // v5 input metadata goes here; we read this in the middleware:
          usageLogger: { tags: ['qbr', 'analysis'] },
        },
      });

    console.log(result.text)
}
  
run()