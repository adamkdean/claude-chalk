// SGR emitter + transformer tests: markup in, exact escape sequences out.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { drawRun, sgr, transformChalk } from '../chalk.ts'

const E = (s) => `\x1b[${s}m` // one SGR sequence

test('named colours map to the 16-colour palette', () => {
  assert.strictEqual(sgr({ color: 'red' }), '31')
  assert.strictEqual(sgr({ color: 'green' }), '32')
  assert.strictEqual(sgr({ color: 'whiteBright' }), '97')
  assert.strictEqual(sgr({ color: 'blackBright' }), '90') // gray/grey land here via parseStyle
  assert.strictEqual(sgr({ backgroundColor: 'blue' }), '44')
  assert.strictEqual(sgr({ backgroundColor: 'redBright' }), '101')
})

test('exact colours go out as 24-bit truecolour', () => {
  assert.strictEqual(sgr({ color: '#ff8800' }), '38;2;255,136,0')
  assert.strictEqual(sgr({ backgroundColor: 'rgb(10,20,30)' }), '48;2;10,20,30')
  assert.strictEqual(sgr({ color: '#ffffff', backgroundColor: '#cc0000' }), '38;2;255,255,255;48;2;204,0,0')
})

test('xterm-256 colours go out as 38;5 / 48;5', () => {
  assert.strictEqual(sgr({ color: 'x256(196)' }), '38;5;196')
  assert.strictEqual(sgr({ backgroundColor: 'x256(45)' }), '48;5;45')
  assert.strictEqual(transformChalk('{x256(196) red}'), `${E('38;5;196')}red\x1b[0m`)
  assert.strictEqual(transformChalk('{bgX256(45).bold navy}'), `${E('48;5;45;1')}navy\x1b[0m`)
})

test('invalid x256 tokens stay literal', () => {
  assert.strictEqual(transformChalk('{x256(999) nope}'), undefined)
  assert.strictEqual(transformChalk('{x256} placeholder'), undefined)
})

test('modifiers stack in a fixed order after the colours', () => {
  assert.strictEqual(sgr({ color: 'red', bold: true }), '31;1')
  assert.strictEqual(sgr({ bold: true, dim: true }), '1;2')
  assert.strictEqual(sgr({ italic: true, underline: true, inverse: true, strikethrough: true }), '3;4;7;9')
  assert.strictEqual(sgr({}), '')
})

test('a run is wrapped in its SGR sequence and reset', () => {
  assert.strictEqual(drawRun({ text: 'x', style: { color: 'red' } }), `${E(31)}x\x1b[0m`)
  assert.strictEqual(drawRun({ text: 'plain', style: {} }), 'plain')
})

test('text without markup is left to the engine', () => {
  assert.strictEqual(transformChalk('Plain **markdown** reply.'), undefined)
  assert.strictEqual(transformChalk('Use {name} as a placeholder, or {red}.'), undefined)
  assert.strictEqual(transformChalk('Run `echo {red text}` to see it.'), undefined)
})

test('a styled block is drawn in SGR', () => {
  assert.strictEqual(transformChalk('{green ✓ All 42 tests pass}'), `${E(32)}✓ All 42 tests pass\x1b[0m`)
})

test('mixed chunks keep their spacing and the markdown stays markdown', () => {
  const out = transformChalk('Intro line.\n\n{bgRed.white Is this right?}\n\n- one\n- two')
  assert.strictEqual(out, `Intro line.\n\n${E('37;41')}Is this right?\x1b[0m\n\n- one\n- two`)
})

test('list markers are re-emitted so the engine still reads them as lists', () => {
  assert.strictEqual(transformChalk('- {green ok}'), `- ${E(32)}ok\x1b[0m`)
})

test('nested blocks add inner styles to outer ones', () => {
  assert.strictEqual(transformChalk('{bold a {red b}}'), `${E(1)}a \x1b[0m${E('31;1')}b\x1b[0m`)
})

test('inline code inside a styled block inherits the surrounding style', () => {
  const out = transformChalk('{red see `x` here}')
  assert.strictEqual(out, `${E(31)}see \x1b[0m${E(31)}x\x1b[0m${E(31)} here\x1b[0m`)
})

test('an unclosed block while streaming is drawn as far as it has gone', () => {
  assert.strictEqual(transformChalk('{red te'), `${E(31)}te\x1b[0m`)
})
