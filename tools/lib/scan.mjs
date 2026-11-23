/* ============================================================
 * tools/lib/scan.mjs —— 给生成脚本用的轻量 JS 源码扫描
 * ------------------------------------------------------------
 * 只做两件事，够 gen-arcade.mjs 用：
 *   fnEnd(src, at)   从 at 处的 function 定义开始，返回函数体配对 } 之后的位置
 *   blockEnd(src,at) 从 at 处的 { 开始，返回配对 } 之后的位置
 *
 * 为什么不用正则：上游是压缩过的单文件脚本，字符串里混着 {}、/ 与转义，
 * 正则数不准。这里按字符扫，跳过 ' " ` 三种字符串与 /.../ 正则字面量。
 * ============================================================ */

/* 从 i 开始是一个正则字面量吗？看它前面最近的非空白字符即可判断 */
function regexAllowed(src, i) {
  for (let k = i - 1; k >= 0; k--) {
    const c = src[k];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
    /* 出现在这些字符之后的 / 一定是除法，不是正则 */
    return !/[\w$)\]]/.test(c);
  }
  return true;
}

export function blockEnd(src, at) {
  let i = src.indexOf('{', at);
  if (i < 0) return -1;
  let depth = 0, q = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c.charCodeAt(0) === 92) { i++; continue; }   /* 反斜杠：跳过下一个字符 */
      if (c === q) q = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && regexAllowed(src, i)) {
      let k = i + 1, cls = false, ok = false;
      for (; k < src.length; k++) {
        const d = src[k];
        if (d.charCodeAt(0) === 92) { k++; continue; }
        if (d === '\n') break;
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) { ok = true; break; }
      }
      if (ok) { i = k; continue; }
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

export function fnEnd(src, at) {
  if (at < 0) return -1;
  const p = src.indexOf('(', at);
  const b = src.indexOf('{', at);
  if (b < 0 || (p > -1 && p < b)) {
    /* 跳过参数表里的默认值对象 { } —— 直接找参数表配对 ) 之后再找 { */
    if (p > -1 && p < b) {
      let d = 0;
      for (let k = p; k < src.length; k++) {
        if (src[k] === '(') d++;
        else if (src[k] === ')') { d--; if (d === 0) { return blockEnd(src, src.indexOf('{', k)); } }
      }
    }
  }
  return blockEnd(src, at);
}
