// pi-chalk — colour markup for Pi replies (port of claude-chalk).
//
// Teaches the model chalk-template markup ({red text}, {bgRed.white …}) in a
// system prompt section, and draws it in the interactive transcript by
// emitting raw SGR sequences into the assistant markdown before Pi renders
// it. The stored session keeps the raw markup; only the drawing changes.
//
// Failure mode is "markup shown as written": any error in the transform falls
// back to the original text, so this extension can garble colours but not the
// interface.

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
const X256 = /^(bg)?[xX]256\((\d{1,3})\)$/
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
  const x256 = X256.exec(t)
  if (x256) {
    const n = Number(x256[2])
    if (n > 255) return undefined
    const value = `x256(${n})`
    return x256[1] === 'bg' ? { backgroundColor: value } : { color: value }
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

// --- SGR emission -----------------------------------------------------------
// The terminal paints the 16 ANSI colours by name from its own palette; hex
// and rgb values are drawn exactly as 24-bit truecolour.

const FG: Record<string, string> = {
  black: '30', red: '31', green: '32', yellow: '33', blue: '34', magenta: '35', cyan: '36', white: '37',
}
const BRIGHT_FG: Record<string, string> = {
  blackBright: '90', redBright: '91', greenBright: '92', yellowBright: '93', blueBright: '94', magentaBright: '95', cyanBright: '96', whiteBright: '97',
}
const BG: Record<string, string> = {
  black: '40', red: '41', green: '42', yellow: '43', blue: '44', magenta: '45', cyan: '46', white: '47',
}
const BRIGHT_BG: Record<string, string> = {
  blackBright: '100', redBright: '101', greenBright: '102', yellowBright: '103', blueBright: '104', magentaBright: '105', cyanBright: '106', whiteBright: '107',
}

const X256_VALUE = /^x256\((\d{1,3})\)$/

function x256Code(value: string): string | undefined {
  const m = X256_VALUE.exec(value)
  return m ? m[1] : undefined
}

function rgbParts(value: string): string | undefined {
  if (value.startsWith('#')) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
    if (!m) return undefined
    let d = m[1]
    if (d.length === 3) d = [...d].map(c => c + c).join('')
    return [parseInt(d.slice(0, 2), 16), parseInt(d.slice(2, 4), 16), parseInt(d.slice(4, 6), 16)].join(',')
  }
  const m = /^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/.exec(value)
  if (!m) return undefined
  return [m[1], m[2], m[3]].join(',')
}

// The SGR parameter string for one run's style, or '' when it sets nothing.
export function sgr(style: Style): string {
  const codes: string[] = []
  if (style.color) {
    const named = FG[style.color] ?? BRIGHT_FG[style.color]
    const x256 = named ? undefined : x256Code(style.color)
    const rgb = named || x256 !== undefined ? undefined : rgbParts(style.color)
    if (named) codes.push(named)
    else if (x256 !== undefined) codes.push(`38;5;${x256}`)
    else if (rgb) codes.push(`38;2;${rgb}`)
  }
  if (style.backgroundColor) {
    const named = BG[style.backgroundColor] ?? BRIGHT_BG[style.backgroundColor]
    const x256 = named ? undefined : x256Code(style.backgroundColor)
    const rgb = named || x256 !== undefined ? undefined : rgbParts(style.backgroundColor)
    if (named) codes.push(named)
    else if (x256 !== undefined) codes.push(`48;5;${x256}`)
    else if (rgb) codes.push(`48;2;${rgb}`)
  }
  if (style.bold) codes.push('1')
  if (style.dim) codes.push('2')
  if (style.italic) codes.push('3')
  if (style.underline) codes.push('4')
  if (style.inverse) codes.push('7')
  if (style.strikethrough) codes.push('9')
  return codes.join(';')
}

// One run drawn: its SGR sequence, the text, and a reset when it set styles.
export function drawRun(run: Run): string {
  const code = sgr(run.style)
  return code ? `\x1b[${code}m${run.text}\x1b[0m` : run.text
}

// A styled paragraph back to text, list markers included so the engine still
// reads them as lists.
export function drawLines(lines: Line[]): string {
  return lines.map(line => line.marker + line.runs.map(drawRun).join('')).join('\n')
}

// The reply with every styled chunk drawn; undefined when it holds no markup.
export function transformChalk(markdown: string): string | undefined {
  const chunks = parse(markdown)
  if (!chunks) return undefined
  let out = ''
  for (const c of chunks) {
    const text = c.kind === 'styled' ? drawLines(c.lines) : c.text
    out += (out ? (c.gap ? '\n\n' : '\n') : '') + text
  }
  return out
}

// --- Extension registration --------------------------------------------------

const GUIDE = `# Colour in replies

Your replies are drawn with colour markup in chalk-template syntax: {style text}. Chain styles with dots, and nest blocks.

- Colours: black, red, green, yellow, blue, magenta, cyan, white, gray, and each of the first eight with a Bright suffix (redBright).
- Backgrounds: bg and a colour (bgRed, bgBlueBright).
- Modifiers: bold, dim, italic, underline, inverse, strikethrough.
- Exact colours: {#ff8800 text}, {#:003366 background}, {#ffffff:cc0000 both}, {rgb(255,136,0) text}, {bgRgb(0,51,102) text}.
- Xterm-256 (fallback for terminals without truecolor): {x256(196) text}, {bgX256(45) text}. Some terminals (e.g. Windows PowerShell 7) drop 38;2 truecolour sequences — use x256() there.

Examples: {green ✓ All 42 tests pass}, {red.bold Build failed}, {yellow Warning:} the cache is stale, {bgBlue.whiteBright  Which region should it deploy to? }, {bgRed.whiteBright  Delete these 3 files? }.

Use colour where it helps the reader see something at a glance: red for errors and failures, green for success, yellow for warnings, cyan or magenta for names worth spotting. Colour a word, a phrase or a line, and leave most text plain. Do not use white or black text without a background, because the reader's theme can be light or dark.

When you need an answer or a decision from the reader before you can go on, put that question on its own line on a background colour, so it cannot be missed: bgBlue for an ordinary question, bgRed when the answer allows something risky or hard to undo.

The markup is drawn in your prose only. Inside code spans and code blocks it shows as written, so never put it there, and never in files, commit messages or tool input. Keep each block inside one paragraph. Inside a block, write \\{ and \\} for literal braces.`

export default function chalk(pi: any) {
  // Teach the model the markup only where something will draw it (the TUI).
  try {
    pi.on('before_agent_start', (event: any, ctx: any) => {
      try {
        if (ctx?.mode !== 'tui') return
        event.systemPromptOptions.sections.chalk = GUIDE
      } catch { /* never break agent start over a prompt section */ }
    })
  } catch { /* registration is best-effort; drawing still works without the guide */ }

  // Draw each assistant reply that holds markup. The stored transcript keeps
  // the raw markup; only this string changes. Any error falls back to the
  // original text, so a bug shows as written markup, never a broken UI.
  pi.registerMarkdownTransformer((markdown: string, ctx: any) => {
    try {
      if (ctx.messageType !== 'assistant') return markdown
      return transformChalk(markdown) ?? markdown
    } catch {
      return markdown
    }
  })
}
