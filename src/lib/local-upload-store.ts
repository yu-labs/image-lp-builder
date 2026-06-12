import { isLocalDevRequest } from './local-dev';

interface LocalUploadObject {
  body: ArrayBuffer;
  contentType: string;
  etag: string;
  size: number;
}

const STORE_KEY = Symbol.for('image-lp-builder.local-upload-store');
const OBJECT_KEY_PATTERN =
  /^images\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(webp|png|jpg)$/;

function store(): Map<string, LocalUploadObject> {
  const root = globalThis as typeof globalThis & {
    [STORE_KEY]?: Map<string, LocalUploadObject>;
  };
  root[STORE_KEY] ??= new Map();
  return root[STORE_KEY];
}

export function canUseLocalUploadStore(request: Request): boolean {
  return isLocalDevRequest(request);
}

export function isValidUploadObjectKey(key: string): boolean {
  return OBJECT_KEY_PATTERN.test(key);
}

export function putLocalUpload(
  key: string,
  body: ArrayBuffer,
  contentType: string
): void {
  if (!isValidUploadObjectKey(key)) {
    throw new Error(`Invalid local upload key: ${key}`);
  }
  store().set(key, {
    body: body.slice(0),
    contentType,
    etag: `"local-${crypto.randomUUID()}"`,
    size: body.byteLength,
  });
}

export function getLocalUpload(key: string): LocalUploadObject | null {
  if (!isValidUploadObjectKey(key)) return null;
  const object = store().get(key);
  if (!object) return null;
  return { ...object, body: object.body.slice(0) };
}

export function deleteLocalUpload(key: string): void {
  if (!isValidUploadObjectKey(key)) return;
  store().delete(key);
}
