/**
 * The only host globals `core` is allowed to touch.
 *
 * `core` must stay free of platform APIs so the same code runs under Node (tests),
 * Hermes (Android) and Electron. Rather than pulling in @types/node — which would
 * make `fs`, `Buffer` and friends type-check inside core and quietly invite a
 * platform dependency — the globals actually needed are declared here.
 *
 * WebCrypto is present natively in Node 20+ and Electron. On React Native it needs
 * polyfilling (`react-native-get-random-values`, plus a WebCrypto shim or a native
 * crypto module), imported once at app entry before anything from this package.
 * That is also the seam where Argon2id should replace PBKDF2: supply a different
 * CryptoProvider rather than changing anything here.
 */

interface CryptoKeyLike {
  readonly type: string;
}

interface SubtleCryptoLike {
  importKey(
    format: string,
    keyData: ArrayBuffer | ArrayBufferView,
    algorithm: string | Record<string, unknown>,
    extractable: boolean,
    keyUsages: readonly string[],
  ): Promise<CryptoKeyLike>;

  deriveBits(
    algorithm: Record<string, unknown>,
    baseKey: CryptoKeyLike,
    length: number,
  ): Promise<ArrayBuffer>;

  encrypt(
    algorithm: Record<string, unknown>,
    key: CryptoKeyLike,
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<ArrayBuffer>;

  decrypt(
    algorithm: Record<string, unknown>,
    key: CryptoKeyLike,
    data: ArrayBuffer | ArrayBufferView,
  ): Promise<ArrayBuffer>;
}

declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  readonly subtle: SubtleCryptoLike;
};
