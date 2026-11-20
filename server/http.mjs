export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function fail(status, message) {
  throw new ApiError(status, message);
}

export const str = (value, max = 150) => String(value ?? '').trim().slice(0, max);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readBytes(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) fail(413, '資料太大。');
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        fail(413, '資料太大。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function readBody(request) {
  try {
    const raw = await readBytes(request, 24000);
    const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '請提交 JSON 物件。');
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, '請提交有效 JSON。');
  }
}
