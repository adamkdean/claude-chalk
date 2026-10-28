import type { Register } from 'claude-code'

import { parse, type Run } from './markup'

// The terminal paints the 16 ANSI colours by name, from the person's own
// palette. Other surfaces take CSS colours: the xterm defaults.
const XTERM: Record<string, string> = {
  black: '#000000',
  red: '#cd0000',
  green: '#00cd00',
  yellow: '#cdcd00',
  blue: '#0000ee',
  magenta: '#cd00cd',
  cyan: '#00cdcd',
  white: '#e5e5e5',
  blackBright: '#7f7f7f',
  redBright: '#ff0000',
  greenBright: '#00ff00',
  yellowBright: '#ffff00',
  blueBright: '#5c5cff',
  magentaBright: '#ff00ff',
  cyanBright: '#00ffff',
  whiteBright: '#ffffff',
}

function paint(value: string | undefined, isTerminal: boolean): string | undefined {
  if (value === undefined || isTerminal || value.startsWith('#') || value.startsWith('rgb(')) return value
  return XTERM[value]
}

const GUIDE = `# Colour in replies

Your replies are drawn with colour markup in chalk-template syntax: {style text}. Chain styles with dots, and nest blocks.

- Colours: black, red, green, yellow, blue, magenta, cyan, white, gray, and each of the first eight with a Bright suffix (redBright).
- Backgrounds: bg and a colour (bgRed, bgBlueBright).
- Modifiers: bold, dim, italic, underline, inverse, strikethrough.
- Exact colours: {#ff8800 text}, {#:003366 background}, {#ffffff:cc0000 both}, {rgb(255,136,0) text}, {bgRgb(0,51,102) text}.

Examples: {green ✓ All 42 tests pass}, {red.bold Build failed}, {yellow Warning:} the cache is stale, {bgRed.whiteBright  Delete these 3 files? }.

Use colour where it helps the reader see something at a glance: red for errors and failures, green for success, yellow for warnings, a background colour for a question that needs an answer, cyan or magenta for names worth spotting. Colour a word, a phrase or a line, and leave most text plain. Do not use white or black text without a background, because the reader's theme can be light or dark.

The markup is drawn in your prose only. Inside code spans and code blocks it shows as written, so never put it there, and never in files, commit messages or tool input. Keep each block inside one paragraph. Inside a block, write \\{ and \\} for literal braces.`

// Text props for one run, leaving out what the run does not set.
function props({ style }: Run, isTerminal: boolean) {
  const out: Record<string, string | boolean> = {}
  const color = paint(style.color, isTerminal) ?? (style.code ? 'permission' : undefined)
  const backgroundColor = paint(style.backgroundColor, isTerminal)
  if (color) out.color = color
  if (backgroundColor) out.backgroundColor = backgroundColor
  if (style.bold) out.weight = 'bold'
  if (style.dim) out.dimColor = true
  if (style.italic) out.italic = true
  if (style.underline) out.underline = true
  if (style.inverse) out.inverse = true
  if (style.strikethrough) out.strikethrough = true
  return out
}

export const register: Register = on => {
  // Teach the model the markup, unless nothing will draw it (a headless run).
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (e.surfaces.length === 0) return result

    return {
      sections: [...result.sections, { id: 'color-replies:guide', text: GUIDE, scope: 'session' }],
    }
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const chunks = parse(e.props.text)
    if (!chunks) return next(e)

    const { Box, Markdown, Text } = $.ui.resolve(e)
    const isTerminal = e.surface === 'terminal'

    const body = chunks.map(chunk => (
      <Box marginTop={chunk.gap ? 1 : 0}>
        {chunk.kind === 'markdown' ? (
          <Markdown text={chunk.text} />
        ) : (
          <Text>
            {chunk.runs.map(run => (
              <Text {...props(run, isTerminal)}>{run.text}</Text>
            ))}
          </Text>
        )}
      </Box>
    ))

    if (!isTerminal) return <Box flexDirection="column">{body}</Box>

    return (
      <Box flexDirection="row" marginTop={1}>
        <Box minWidth={2}>
          <Text>{e.props.isFirstOfReply ? '⏺' : ' '}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {body}
        </Box>
      </Box>
    )
  })
}
