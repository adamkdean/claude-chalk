// Parses chalk-template markup ({red text}, {bgRed.white text}, {#ff8800 text})
// out of a reply's markdown. Paragraphs that hold markup become styled lines;
// everything else stays markdown for the engine to draw.

export type Style = {
  // A chalk colour name ('red', 'redBright'), '#rrggbb' or 'rgb(r,g,b)'.
  color?: string
  backgroundColor?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
  strikethrough?: boolean
  code?: boolean
}

export type Run = { text: string; style: Style }

// One line of a styled paragraph. `marker` is a list item's mark ('- ', '2. ')
// with its indent, or '' on any other line.
export type Line = { marker: string; runs: Run[] }

export type Chunk =
  | { kind: 'markdown'; text: string; gap: boolean }
  | { kind: 'styled'; lines: Line[]; gap: boolean }

const COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const NAMES = new Set([...COLORS, ...COLORS.map(c => `${c}Bright`)])
const MODIFIERS = new Set(['bold', 'dim', 'italic', 'underline', 'inverse', 'strikethrough'])

const OPEN = /\{([^\s{}]+) /y
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB = /^(rgb|bgRgb)\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/
const HEX_FN = /^(hex|bgHex)\(['"]?(#[0-9a-f]{3,6})['"]?\)$/i
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/
const HEADING = /^ {0,3}#{1,6}\s+/
const LIST = /^ {0,6}(?:[-*+]|\d{1,3}[.)]) +/

function hex(value: string): string | undefined {
  const m = HEX.exec(value)?.[1]
  if (!m) return undefined
  const digits = m.length === 3 ? [...m].map(d => d + d).join('') : m
  return `#${digits.toLowerCase()}`
}

function color(name: string): string | undefined {
  if (name === 'gray' || name === 'grey') return 'blackBright'
  return NAMES.has(name) ? name : undefined
}

// One token of a style chain, or undefined when it is not a style.
function token(t: string): Style | undefined {
  if (MODIFIERS.has(t)) return { [t]: true } as Style
  const fg = color(t)
  if (fg) return { color: fg }
  if (/^bg[A-Z]/.test(t)) {
    const bg = color(t.charAt(2).toLowerCase() + t.slice(3))
    if (bg) return { backgroundColor: bg }
  }
  const rgb = RGB.exec(t)
  if (rgb) {
    const [r = 0, g = 0, b = 0] = rgb.slice(2).map(Number)
    if (r > 255 || g > 255 || b > 255) return undefined
    const value = `rgb(${r},${g},${b})`
    return rgb[1] === 'rgb' ? { color: value } : { backgroundColor: value }
  }
  const fn = HEX_FN.exec(t)
  if (fn) {
    const value = hex(fn[2] ?? '')
    if (!value) return undefined
    return fn[1] === 'hex' ? { color: value } : { backgroundColor: value }
  }
  if (t.startsWith('#')) {
    const [fg, bg, ...rest] = t.slice(1).split(':')
    if (rest.length) return undefined
    const style: Style = {}
    if (fg) style.color = hex(fg)
    if (bg) style.backgroundColor = hex(bg)
    if ((fg && !style.color) || (bg && !style.backgroundColor) || (!fg && !bg)) return undefined
    return style
  }
  return undefined
}

// A dotted style chain ('bgRed.white.bold'), or undefined when any part is
// not a style, so prose such as {name} is left alone.
export function parseStyle(chain: string): Style | undefined {
  let style: Style = {}
  for (const t of chain.split('.')) {
    const s = token(t)
    if (!s) return undefined
    style = { ...style, ...s }
  }
  return style
}

// Splits text into blocks at blank lines, keeping each fenced code block whole
// and on its own. `gap` says whether blank lines came before the block.
function blocks(lines: string[]) {
  const out: { start: number; end: number; isCode: boolean; gap: boolean }[] = []
  let start = -1
  let gap = false
  let fence = ''
  const close = (end: number, isCode: boolean) => {
    if (start >= 0) out.push({ start, end, isCode, gap })
    start = -1
    gap = false
  }

  lines.forEach((line, i) => {
    if (fence) {
      const marks = FENCE_CLOSE.exec(line)?.[1]
      if (marks && marks[0] === fence[0] && marks.length >= fence.length) {
        fence = ''
        close(i, true)
      }
      return
    }
    const marks = FENCE_OPEN.exec(line)?.[1]
    if (marks) {
      close(i - 1, false)
      fence = marks
      start = i
      return
    }
    if (line.trim() === '') {
      if (start >= 0) close(i - 1, false)
      if (out.length) gap = true
      return
    }
    if (start < 0) start = i
  })
  close(lines.length - 1, fence !== '')

  return out
}

function hasLater(text: string, from: number, marker: string): boolean {
  return text.indexOf(marker, from) >= 0
}

// Styled lines for one paragraph, or undefined when it holds no markup. Inline
// markdown that styled text would otherwise show raw (bold, italic, code,
// heading marks, list marks, backslash escapes) is drawn as the engine would.
export function lines(text: string): Line[] | undefined {
  let line: Line = { marker: '', runs: [] }
  const out = [line]
  const stack: Style[] = [{}]
  let buffer = ''
  let isBold = false
  let isItalic = false
  let isHeading = false
  let hasMarkup = false

  const current = (): Style => {
    const style = { ...stack[stack.length - 1] }
    if (isBold || isHeading) style.bold = true
    if (isItalic) style.italic = true
    return style
  }
  const flush = () => {
    if (buffer) line.runs.push({ text: buffer, style: current() })
    buffer = ''
  }

  let i = 0
  let lineStart = true
  while (i < text.length) {
    if (lineStart) {
      lineStart = false
      const heading = HEADING.exec(text.slice(i))
      if (heading) {
        isHeading = true
        i += heading[0].length
        continue
      }
      const list = LIST.exec(text.slice(i))
      if (list) {
        line.marker = list[0]
        i += list[0].length
        continue
      }
    }

    const ch = text[i]
    const next = text[i + 1]

    if (ch === '\\' && next && /[!-/:-@[-`{-~]/.test(next)) {
      buffer += next
      i += 2
      continue
    }

    if (ch === '`') {
      let n = 1
      while (text[i + n] === '`') n++
      const ticks = '`'.repeat(n)
      const end = text.indexOf(ticks, i + n)
      if (end > 0 && text[end + n] !== '`') {
        flush()
        let code = text.slice(i + n, end)
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1)
        line.runs.push({ text: code, style: { ...current(), code: true } })
        i = end + n
        continue
      }
      buffer += ticks
      i += n
      continue
    }

    if (ch === '{') {
      OPEN.lastIndex = i
      const m = OPEN.exec(text)
      const style = m?.[1] && parseStyle(m[1])
      if (m && style) {
        flush()
        stack.push({ ...stack[stack.length - 1], ...style })
        hasMarkup = true
        i += m[0].length
        continue
      }
    }

    if (ch === '}' && stack.length > 1) {
      flush()
      stack.pop()
      i++
      continue
    }

    if (ch === '*' && next === '*') {
      if (isBold || hasLater(text, i + 2, '**')) {
        flush()
        isBold = !isBold
        i += 2
        continue
      }
    } else if (ch === '*') {
      const prev = text[i - 1]
      const opens = !isItalic && next && next !== ' ' && hasLater(text, i + 1, '*')
      const closes = isItalic && prev && prev !== ' '
      if (opens || closes) {
        flush()
        isItalic = !isItalic
        i++
        continue
      }
    }

    if (ch === '\n') {
      flush()
      isHeading = false
      lineStart = true
      line = { marker: '', runs: [] }
      out.push(line)
      i++
      continue
    }

    buffer += ch
    i++
  }
  flush()

  return hasMarkup ? out : undefined
}

// The reply's chunks in order, or undefined when the text holds no markup and
// the engine should draw it unchanged.
export function parse(text: string): Chunk[] | undefined {
  if (!text.includes('{')) return undefined

  const rows = text.split('\n')
  const chunks: Chunk[] = []
  let isStyled = false

  for (const block of blocks(rows)) {
    const source = rows.slice(block.start, block.end + 1).join('\n')
    const styled = block.isCode ? undefined : lines(source)
    const last = chunks[chunks.length - 1]

    if (styled) {
      chunks.push({ kind: 'styled', lines: styled, gap: block.gap })
      isStyled = true
    } else if (last?.kind === 'markdown') {
      last.text += (block.gap ? '\n\n' : '\n') + source
    } else {
      chunks.push({ kind: 'markdown', text: source, gap: block.gap })
    }
  }

  return isStyled ? chunks : undefined
}
