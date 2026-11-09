type AssetKind = 'art' | 'tiles';

/** 单文件版会把图片内联为 data URI，通过该全局映射覆盖默认的相对路径 */
const embedded: Record<string, string> =
  (window as unknown as { __INK_ASSETS__?: Record<string, string> }).__INK_ASSETS__ ?? {};

export function assetUrl(kind: AssetKind, name: string): string {
  return embedded[`${kind}/${name}`] ?? `./assets/${kind}/${name}.jpg`;
}
