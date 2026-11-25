import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, generateVaultKey } from '../src/shared/crypto';

describe('凭证快照加密', () => {
  it('生成的密钥为 32 字节', () => {
    const key = generateVaultKey();
    expect(Buffer.from(key, 'base64')).toHaveLength(32);
  });

  it('加密后可以正确解密', async () => {
    const key = generateVaultKey();
    const payload = {
      siteId: 'site_1',
      cookies: [
        { name: 'SESSDATA', value: 'abc', domain: '.example.com', path: '/' },
        { name: 'token', value: 'x'.repeat(32), domain: '.example.com', path: '/' },
      ],
    };
    const encrypted = await encryptJson(payload, key);
    expect(encrypted.cipher).not.toContain('SESSDATA');
    expect(encrypted.iv.length).toBeGreaterThan(0);
    const decrypted = await decryptJson<typeof payload>(encrypted, key);
    expect(decrypted).toEqual(payload);
  });

  it('使用错误密钥无法解密', async () => {
    const encrypted = await encryptJson({ secret: 'value' }, generateVaultKey());
    await expect(decryptJson(encrypted, generateVaultKey())).rejects.toThrow();
  });

  it('同一明文每次加密结果不同（随机 IV）', async () => {
    const key = generateVaultKey();
    const first = await encryptJson({ a: 1 }, key);
    const second = await encryptJson({ a: 1 }, key);
    expect(first.cipher).not.toBe(second.cipher);
    expect(first.iv).not.toBe(second.iv);
  });
});
