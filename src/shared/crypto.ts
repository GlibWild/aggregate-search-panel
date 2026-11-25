/**
 * 登录凭证快照的本地加密（AES-GCM）。
 *
 * 说明：密钥同样保存在扩展本地存储中，这里的加密用于避免 Cookie 明文
 * 出现在存储/导出文件里，不能防御已经获得扩展存储读权限的攻击者。
 */

const KEY_ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;
const ADDITIONAL_DATA = new TextEncoder().encode('agg-vault-v1');

function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** 生成一个新的 256 位密钥（base64）。 */
export function generateVaultKey(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(raw);
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64ToBytes(base64Key), KEY_ALGORITHM, false, [
    'encrypt',
    'decrypt',
  ]);
}

export interface EncryptedPayload {
  cipher: string;
  iv: string;
}

/** 加密任意可序列化对象。 */
export async function encryptJson(value: unknown, base64Key: string): Promise<EncryptedPayload> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: KEY_ALGORITHM, iv, additionalData: ADDITIONAL_DATA },
    key,
    plaintext,
  );
  return {
    cipher: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

/** 解密并反序列化。 */
export async function decryptJson<T>(
  payload: EncryptedPayload,
  base64Key: string,
): Promise<T> {
  const key = await importKey(base64Key);
  const decrypted = await crypto.subtle.decrypt(
    { name: KEY_ALGORITHM, iv: base64ToBytes(payload.iv), additionalData: ADDITIONAL_DATA },
    key,
    base64ToBytes(payload.cipher),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}
