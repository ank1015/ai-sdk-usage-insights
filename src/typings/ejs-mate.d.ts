declare module 'ejs-mate' {
  import type { Options as EjsOptions } from 'ejs';

  type Callback = (err: Error | null, rendered?: string) => void;

  export default function ejsMate(
    filePath: string,
    options: EjsOptions<Record<string, unknown>> & Record<string, unknown>,
    callback: Callback
  ): void;
}
