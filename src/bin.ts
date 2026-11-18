#!/usr/bin/env node
import { main } from './cli';

// `url-to-markdown ... | head` closes the pipe early: stop quietly instead of crashing.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

main(process.argv.slice(2), {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  readStdin,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`url-to-markdown: ${(err as Error)?.stack ?? String(err)}\n`);
    process.exitCode = 1;
  },
);
