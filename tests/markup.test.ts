import { expect, test } from 'claude-code/testing'

import { lines, parse, parseStyle, type Run } from '../hooks/markup'

// One line of a styled paragraph with no list marker.
const plain = (...runs: Run[]) => ({ marker: '', runs })

test('style chains read as chalk reads them', async () => {
  expect(parseStyle('red')).toEqual({ color: 'red' })
  expect(parseStyle('redBright')).toEqual({ color: 'redBright' })
  expect(parseStyle('gray')).toEqual({ color: 'blackBright' })
  expect(parseStyle('bgRed.white')).toEqual({ backgroundColor: 'red', color: 'white' })
  expect(parseStyle('bgGreenBright')).toEqual({ backgroundColor: 'greenBright' })
  expect(parseStyle('bold.italic.underline')).toEqual({ bold: true, italic: true, underline: true })
  expect(parseStyle('dim.inverse.strikethrough')).toEqual({ dim: true, inverse: true, strikethrough: true })
})

test('hex and rgb forms read as chalk-template reads them', async () => {
  expect(parseStyle('#FF8800')).toEqual({ color: '#ff8800' })
  expect(parseStyle('#f80')).toEqual({ color: '#ff8800' })
  expect(parseStyle('#:123456')).toEqual({ backgroundColor: '#123456' })
  expect(parseStyle('#abcdef:123456')).toEqual({ color: '#abcdef', backgroundColor: '#123456' })
  expect(parseStyle('rgb(255,131,0)')).toEqual({ color: 'rgb(255,131,0)' })
  expect(parseStyle('bgRgb(10,20,30)')).toEqual({ backgroundColor: 'rgb(10,20,30)' })
  expect(parseStyle("hex('#00ff00')")).toEqual({ color: '#00ff00' })
  expect(parseStyle('bgHex(#00f)')).toEqual({ backgroundColor: '#0000ff' })
})

test('anything that is not a style is not markup', async () => {
  for (const chain of ['name', 'redd', 'bgred', 'bg', '#12', '#', 'rgb(300,0,0)', 'rgb(1, 2, 3)', 'red.name']) {
    expect(parseStyle(chain)).toBeUndefined()
  }
})

test('text without markup is left to the engine', async () => {
  expect(parse('Plain **markdown** reply.')).toBeUndefined()
  expect(parse('Use {name} as a placeholder, or {red}.')).toBeUndefined()
  expect(parse('Run `echo {red text}` to see it.')).toBeUndefined()
  expect(parse('```js\nconst x = {red: 1}\nlog({red text})\n```')).toBeUndefined()
})

test('a paragraph with markup is styled and the rest stays markdown', async () => {
  const chunks = parse('Intro line.\n\n{bgRed.white Is this right?}\n\n- one\n- two')

  expect(chunks).toEqual([
    { kind: 'markdown', text: 'Intro line.', gap: false },
    {
      kind: 'styled',
      gap: true,
      lines: [plain({ text: 'Is this right?', style: { backgroundColor: 'red', color: 'white' } })],
    },
    { kind: 'markdown', text: '- one\n- two', gap: true },
  ])
})

test('markdown blocks either side of a fence keep their spacing', async () => {
  const chunks = parse('{green Done.}\n\nSee:\n```sh\nls\n```\nEnd.')

  expect(chunks?.[1]).toEqual({ kind: 'markdown', text: 'See:\n```sh\nls\n```\nEnd.', gap: true })
})

test('blocks nest, and inner styles add to outer ones', async () => {
  expect(lines('{bold Hello {red world}!}')).toEqual([
    plain(
      { text: 'Hello ', style: { bold: true } },
      { text: 'world', style: { bold: true, color: 'red' } },
      { text: '!', style: { bold: true } },
    ),
  ])
})

test('inline markdown inside a styled paragraph is drawn, not shown raw', async () => {
  expect(lines('{yellow Warning:} **do not** run `rm`, *really*')).toEqual([
    plain(
      { text: 'Warning:', style: { color: 'yellow' } },
      { text: ' ', style: {} },
      { text: 'do not', style: { bold: true } },
      { text: ' run ', style: {} },
      { text: 'rm', style: { code: true } },
      { text: ', ', style: {} },
      { text: 'really', style: { italic: true } },
    ),
  ])
})

test('a heading line is bold without its marks', async () => {
  expect(lines('## {cyan Status}')).toEqual([plain({ text: 'Status', style: { bold: true, color: 'cyan' } })])
})

test('list items keep their marker apart, so wrapped text can hang under it', async () => {
  expect(lines('Failures\n- {red auth}: broke\n  * nested\n2. {green ok}')).toEqual([
    plain({ text: 'Failures', style: {} }),
    { marker: '- ', runs: [{ text: 'auth', style: { color: 'red' } }, { text: ': broke', style: {} }] },
    { marker: '  * ', runs: [{ text: 'nested', style: {} }] },
    { marker: '2. ', runs: [{ text: 'ok', style: { color: 'green' } }] },
  ])
})

test('escaped braces are literal', async () => {
  expect(lines('{red a \\{b\\} c}')).toEqual([plain({ text: 'a {b} c', style: { color: 'red' } })])
})

test('an unclosed block runs to the end of its paragraph', async () => {
  expect(lines('{red still streaming')).toEqual([plain({ text: 'still streaming', style: { color: 'red' } })])
})

test('a stray closing brace is literal', async () => {
  expect(lines('{red x} and }')).toEqual([
    plain({ text: 'x', style: { color: 'red' } }, { text: ' and }', style: {} }),
  ])
})

test('a block carries over a line break', async () => {
  expect(lines('{red one\ntwo} three')).toEqual([
    plain({ text: 'one', style: { color: 'red' } }),
    plain({ text: 'two', style: { color: 'red' } }, { text: ' three', style: {} }),
  ])
})
