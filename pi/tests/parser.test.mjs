// Parser regression tests, ported verbatim from claude-chalk's markup.test.ts.
// The parser must stay byte-identical in behaviour to the original mod.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { lines, parse, parseStyle } from '../chalk.ts'

// One line of a styled paragraph with no list marker.
const plain = (...runs) => ({ marker: '', runs })

test('style chains read as chalk reads them', () => {
  assert.deepStrictEqual(parseStyle('red'), { color: 'red' })
  assert.deepStrictEqual(parseStyle('redBright'), { color: 'redBright' })
  assert.deepStrictEqual(parseStyle('gray'), { color: 'blackBright' })
  assert.deepStrictEqual(parseStyle('bgRed.white'), { backgroundColor: 'red', color: 'white' })
  assert.deepStrictEqual(parseStyle('bgGreenBright'), { backgroundColor: 'greenBright' })
  assert.deepStrictEqual(parseStyle('bold.italic.underline'), { bold: true, italic: true, underline: true })
  assert.deepStrictEqual(parseStyle('dim.inverse.strikethrough'), { dim: true, inverse: true, strikethrough: true })
})

test('hex and rgb forms read as chalk-template reads them', () => {
  assert.deepStrictEqual(parseStyle('#FF8800'), { color: '#ff8800' })
  assert.deepStrictEqual(parseStyle('#f80'), { color: '#ff8800' })
  assert.deepStrictEqual(parseStyle('#:123456'), { backgroundColor: '#123456' })
  assert.deepStrictEqual(parseStyle('#abcdef:123456'), { color: '#abcdef', backgroundColor: '#123456' })
  assert.deepStrictEqual(parseStyle('rgb(255,131,0)'), { color: 'rgb(255,131,0)' })
  assert.deepStrictEqual(parseStyle('bgRgb(10,20,30)'), { backgroundColor: 'rgb(10,20,30)' })
  assert.deepStrictEqual(parseStyle("hex('#00ff00')"), { color: '#00ff00' })
  assert.deepStrictEqual(parseStyle('bgHex(#00f)'), { backgroundColor: '#0000ff' })
})

test('anything that is not a style is not markup', () => {
  for (const chain of ['name', 'redd', 'bgred', 'bg', '#12', '#', 'rgb(300,0,0)', 'rgb(1, 2, 3)', 'red.name']) {
    assert.strictEqual(parseStyle(chain), undefined)
  }
})

test('text without markup is left to the engine', () => {
  assert.strictEqual(parse('Plain **markdown** reply.'), undefined)
  assert.strictEqual(parse('Use {name} as a placeholder, or {red}.'), undefined)
  assert.strictEqual(parse('Run `echo {red text}` to see it.'), undefined)
  assert.strictEqual(parse('```js\nconst x = {red: 1}\nlog({red text})\n```'), undefined)
})

test('a paragraph with markup is styled and the rest stays markdown', () => {
  const chunks = parse('Intro line.\n\n{bgRed.white Is this right?}\n\n- one\n- two')

  assert.deepStrictEqual(chunks, [
    { kind: 'markdown', text: 'Intro line.', gap: false },
    {
      kind: 'styled',
      gap: true,
      lines: [plain({ text: 'Is this right?', style: { backgroundColor: 'red', color: 'white' } })],
    },
    { kind: 'markdown', text: '- one\n- two', gap: true },
  ])
})

test('markdown blocks either side of a fence keep their spacing', () => {
  const chunks = parse('{green Done.}\n\nSee:\n```sh\nls\n```\nEnd.')

  assert.deepStrictEqual(chunks?.[1], { kind: 'markdown', text: 'See:\n```sh\nls\n```\nEnd.', gap: true })
})

test('blocks nest, and inner styles add to outer ones', () => {
  assert.deepStrictEqual(lines('{bold Hello {red world}!}'), [
    plain(
      { text: 'Hello ', style: { bold: true } },
      { text: 'world', style: { bold: true, color: 'red' } },
      { text: '!', style: { bold: true } },
    ),
  ])
})

test('inline markdown inside a styled paragraph is drawn, not shown raw', () => {
  assert.deepStrictEqual(lines('{yellow Warning:} **do not** run `rm`, *really*'), [
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

test('a heading line is bold without its marks', () => {
  assert.deepStrictEqual(lines('## {cyan Status}'), [plain({ text: 'Status', style: { bold: true, color: 'cyan' } })])
})

test('list items keep their marker apart, so wrapped text can hang under it', () => {
  assert.deepStrictEqual(lines('Failures\n- {red auth}: broke\n  * nested\n2. {green ok}'), [
    plain({ text: 'Failures', style: {} }),
    { marker: '- ', runs: [{ text: 'auth', style: { color: 'red' } }, { text: ': broke', style: {} }] },
    { marker: '  * ', runs: [{ text: 'nested', style: {} }] },
    { marker: '2. ', runs: [{ text: 'ok', style: { color: 'green' } }] },
  ])
})

test('escaped braces are literal', () => {
  assert.deepStrictEqual(lines('{red a \\{b\\} c}'), [plain({ text: 'a {b} c', style: { color: 'red' } })])
})

test('an unclosed block runs to the end of its paragraph', () => {
  assert.deepStrictEqual(lines('{red still streaming'), [plain({ text: 'still streaming', style: { color: 'red' } })])
})

test('a stray closing brace is literal', () => {
  assert.deepStrictEqual(lines('{red x} and }'), [
    plain({ text: 'x', style: { color: 'red' } }, { text: ' and }', style: {} }),
  ])
})

test('a block carries over a line break', () => {
  assert.deepStrictEqual(lines('{red one\ntwo} three'), [
    plain({ text: 'one', style: { color: 'red' } }),
    plain({ text: 'two', style: { color: 'red' } }, { text: ' three', style: {} }),
  ])
})
