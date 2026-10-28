import { expect, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

function reply(text: string) {
  return {
    plugin: 'chalk',
    component: 'AssistantMessage',
    requestId: 'message-1',
    props: { text, isFirstOfReply: true },
  } as const
}

test('a reply with markup draws its colours on every surface', async ($, on) => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      ...reply('Plan ready.\n\n{bgRed.whiteBright Delete the cache?} {green yes}'),
      surface,
    })
    const isTerminal = surface === 'terminal'

    const question = await ui.find({ type: 'Text', text: /^Delete the cache\?$/ })
    expect(question?.props).toEqual({
      backgroundColor: isTerminal ? 'red' : '#cd0000',
      color: isTerminal ? 'whiteBright' : '#ffffff',
    })
    const answer = await ui.find({ type: 'Text', text: /^yes$/ })
    expect(answer?.props).toEqual({ color: isTerminal ? 'green' : '#00cd00' })
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('Plan ready.')
    await ui.unmount()
  }
})

test('exact colours pass through unchanged', async ($, on) => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...reply('{#ff8800:001122.bold Hot} {rgb(1,2,3) x}'), surface })

    expect((await ui.find({ type: 'Text', text: /^Hot$/ }))?.props).toMatchObject({
      color: '#ff8800',
      backgroundColor: '#001122',
      weight: 'bold',
    })
    expect((await ui.find({ type: 'Text', text: /^x$/ }))?.props).toEqual({ color: 'rgb(1,2,3)' })
    await ui.unmount()
  }
})

test('a reply without markup is left to the engine', async ($, on) => {
  // Nothing draws beneath the plugin in a test: this hook stands for the engine.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...reply('Plain **markdown**, and {braces}.'), surface })

    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    await ui.unmount()
  }
})
