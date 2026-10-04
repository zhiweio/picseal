/**
 * 迷你 Markdown 解析器 —— 服务于第一方文档（public 目录下的 CREDITS.md 等）的站内预览。
 * 零依赖：只覆盖本仓文档实际用到的语法（ATX 标题 / 段落 / 列表 / 围栏代码块，
 * 行内粗斜体、行内代码、链接）；输出纯数据结构，由组件层映射为 JSX（不碰 innerHTML）。
 */

export type MdInline =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'bold'; children: MdInline[] }
  | { kind: 'italic'; children: MdInline[] }
  | { kind: 'link'; href: string; children: MdInline[] }

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; children: MdInline[] }
  | { kind: 'paragraph'; children: MdInline[] }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'code'; lang: string; value: string }

const INLINE_RE = /`([^`]+)`|\*\*([^*]+?)\*\*|\*([^*\n]+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g

/** 只放行站内绝对路径与 http(s) 链接，其余（javascript: 等）降级为不可点 */
function safeHref(href: string): string {
  return /^(https?:\/\/|\/)/i.test(href) ? href : '#'
}

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = []
  let last = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0
    if (start > last) out.push({ kind: 'text', value: text.slice(last, start) })
    const raw = m[0] ?? ''
    const code = m[1]
    const bold = m[2]
    const italic = m[3]
    const linkText = m[4]
    const href = m[5]
    if (code !== undefined) out.push({ kind: 'code', value: code })
    else if (bold !== undefined) out.push({ kind: 'bold', children: parseInline(bold) })
    else if (italic !== undefined) out.push({ kind: 'italic', children: parseInline(italic) })
    else if (linkText !== undefined && href !== undefined)
      out.push({ kind: 'link', href: safeHref(href), children: parseInline(linkText) })
    last = start + raw.length
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) })
  return out
}

const FENCE_OPEN = /^```(\S*)\s*$/
const FENCE_CLOSE = /^```\s*$/
const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/
const BULLET = /^\s*[-*]\s+(.+)$/
const ORDERED = /^\s*(\d+)[.)]\s+(.+)$/
const BLANK = /^\s*$/

function isBlockStart(line: string): boolean {
  return (
    !BLANK.test(line) &&
    !FENCE_OPEN.test(line) &&
    !HEADING.test(line) &&
    !BULLET.test(line) &&
    !ORDERED.test(line)
  )
}

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (BLANK.test(line)) {
      i++
      continue
    }

    const fence = line.match(FENCE_OPEN)
    if (fence) {
      const buf: string[] = []
      i++
      while (i < lines.length && !FENCE_CLOSE.test(lines[i]!)) {
        buf.push(lines[i]!)
        i++
      }
      i++ // 跳过收尾 ```（或到 EOF）
      blocks.push({ kind: 'code', lang: fence[1] ?? '', value: buf.join('\n') })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: (heading[1]?.length ?? 1) as 1 | 2 | 3 | 4,
        children: parseInline(heading[2] ?? '')
      })
      i++
      continue
    }

    const firstBullet = line.match(BULLET)
    const firstOrdered = line.match(ORDERED)
    if (firstBullet || firstOrdered) {
      // match() 命中返回对象、未命中返回 null（不是 undefined），须用宽松相等判断
      const ordered = firstOrdered != null && firstBullet == null
      const items: MdInline[][] = []
      while (i < lines.length) {
        const b = lines[i]!.match(BULLET)
        const o = lines[i]!.match(ORDERED)
        if (!b && !o) break
        items.push(parseInline((b ?? o)?.[1] ?? ''))
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // 段落：连续普通行，软换行保留为 \n（渲染层用 whitespace-pre-line）
    const buf: string[] = []
    while (i < lines.length && isBlockStart(lines[i]!)) {
      buf.push(lines[i]!)
      i++
    }
    if (buf.length > 0) blocks.push({ kind: 'paragraph', children: parseInline(buf.join('\n')) })
  }
  return blocks
}
