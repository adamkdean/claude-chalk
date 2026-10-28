import { expect, test } from 'claude-code/testing'

const BASE = { id: 'intro', text: 'You are Claude Code.', scope: 'shared' } as const

const INPUT = {
  model: 'claude-test',
  promptModel: 'claude-test',
  tools: [],
  outputStyle: null,
  traits: [],
} as const

test('the system prompt teaches the markup where a surface draws it', async ($, on) => {
  // Nothing composes beneath the plugin in a test: this hook stands for the engine.
  on('prompt.compose', () => ({ sections: [BASE] }))

  const { sections } = await $.prompt.compose({ ...INPUT, surfaces: ['terminal'] })

  expect(sections[0]).toEqual(BASE)
  expect(sections[1]?.id).toBe('color-replies:guide')
  expect(sections[1]?.scope).toBe('session')
  expect(sections[1]?.text).toContain('{bgRed.whiteBright')
})

test('a headless run gets no guide', async ($, on) => {
  on('prompt.compose', () => ({ sections: [BASE] }))

  const { sections } = await $.prompt.compose({ ...INPUT, surfaces: [] })

  expect(sections).toEqual([BASE])
})
