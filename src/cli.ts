#!/usr/bin/env node
import { runCli } from './index.js';

runCli().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
