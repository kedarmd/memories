import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

export const MAX_INPUT_BYTES = 128_000;
const READ_CHUNK_BYTES = 16_384;

async function readBounded(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of stream) {
    const chunk = typeof value === 'string' ? Buffer.from(value) : value instanceof Uint8Array
      ? Buffer.from(value)
      : (() => { throw new Error('Input stream must emit text or bytes'); })();
    if (size + chunk.byteLength > MAX_INPUT_BYTES) {
      stream.destroy();
      throw new Error(`Structured input exceeds ${MAX_INPUT_BYTES} bytes`);
    }
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

export async function readStructuredInput(file: string | undefined, input: Readable): Promise<unknown> {
  let content: string;
  if (file === undefined || file === '-') {
    input.pause();
    content = await readBounded(input);
  } else {
    const stats = statSync(file);
    if (!stats.isFile()) throw new Error('Structured input path must name a regular file');
    if (stats.size > MAX_INPUT_BYTES) throw new Error(`Structured input exceeds ${MAX_INPUT_BYTES} bytes`);
    const stream = createReadStream(file, { highWaterMark: READ_CHUNK_BYTES });
    content = await readBounded(stream);
  }
  try { return JSON.parse(content) as unknown; }
  catch { throw new Error('Input must be one valid JSON object'); }
}
