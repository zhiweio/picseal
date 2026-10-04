import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from './markdown'

describe('parseInline', () => {
  it('纯文本原样返回', () => {
    expect(parseInline('只是普通文本')).toEqual([{ kind: 'text', value: '只是普通文本' }])
  })

  it('粗体 / 斜体 / 行内代码 / 链接', () => {
    expect(parseInline('**bold**')).toEqual([{ kind: 'bold', children: [{ kind: 'text', value: 'bold' }] }])
    expect(parseInline('*Walter Mitty*')).toEqual([
      { kind: 'italic', children: [{ kind: 'text', value: 'Walter Mitty' }] }
    ])
    expect(parseInline('`intro.mp4`')).toEqual([{ kind: 'code', value: 'intro.mp4' }])
    expect(parseInline('[版权说明](/cinema/CREDITS.md)')).toEqual([
      { kind: 'link', href: '/cinema/CREDITS.md', children: [{ kind: 'text', value: '版权说明' }] }
    ])
  })

  it('混合行内元素并保留间隔文本', () => {
    const nodes = parseInline('**来自网络**的 `intro.mp4` 与 *配乐*')
    expect(nodes.map((n) => n.kind)).toEqual(['bold', 'text', 'code', 'text', 'italic'])
  })

  it('javascript: 链接降级为不可点', () => {
    expect(parseInline('[x](javascript:void)')).toEqual([
      { kind: 'link', href: '#', children: [{ kind: 'text', value: 'x' }] }
    ])
  })
})

describe('parseMarkdown', () => {
  it('识别各级标题', () => {
    const blocks = parseMarkdown('# 一\n## 二\n### 三')
    expect(blocks.map((b) => (b.kind === 'heading' ? b.level : null))).toEqual([1, 2, 3])
  })

  it('围栏代码块：语言标记 + 多行 + 未闭合兜底', () => {
    const blocks = parseMarkdown('```bash\nline1\nline2\n```\n后文')
    expect(blocks[0]).toEqual({ kind: 'code', lang: 'bash', value: 'line1\nline2' })
    expect(blocks[1]?.kind).toBe('paragraph')
    const unclosed = parseMarkdown('```ts\nnever-closed')
    expect(unclosed[0]).toEqual({ kind: 'code', lang: 'ts', value: 'never-closed' })
  })

  it('连续列表项归入同一列表，有序/无序区分', () => {
    const ul = parseMarkdown('- 甲\n- 乙')[0]
    expect(ul).toMatchObject({ kind: 'list', ordered: false, items: [[{ kind: 'text', value: '甲' }], [{ kind: 'text', value: '乙' }]] })
    const ol = parseMarkdown('1. 甲\n2) 乙')[0]
    expect(ol).toMatchObject({ kind: 'list', ordered: true })
  })

  it('段落吸收连续行（软换行保留），空行分段', () => {
    const blocks = parseMarkdown('第一行\n第二行\n\n第三行')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'text', value: '第一行\n第二行' }
      ]
    })
  })

  it('块级语法终止段落', () => {
    const blocks = parseMarkdown('段落\n## 标题')
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'heading'])
  })

  it('能解析仓库真实的 cinema CREDITS.md', () => {
    const md = readFileSync(new URL('../../public/cinema/CREDITS.md', import.meta.url), 'utf8')
    const blocks = parseMarkdown(md)
    const kinds = blocks.map((b) => b.kind)
    expect(kinds[0]).toBe('heading')
    expect(kinds).toContain('list')
    expect(kinds).toContain('code')
    const code = blocks.find((b) => b.kind === 'code')
    expect(code?.kind === 'code' && code.lang).toBe('bash')
    expect(code?.kind === 'code' && code.value).toContain('ffmpeg -i')
  })
})
