import http from 'node:http'

function event(res, name, data) {
  res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function respond(res, step, id) {
  if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs))
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const calls = step.tools ?? []
  event(res, 'message_start', {
    type: 'message_start',
    message: {
      id: `msg_${id}`,
      type: 'message',
      role: 'assistant',
      model: 'deepseek-flash',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1 },
    },
  })
  let index = 0
  if (step.text !== undefined) {
    event(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
    event(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: step.text } })
    event(res, 'content_block_stop', { type: 'content_block_stop', index })
    index++
  }
  calls.forEach((call, i) => {
    event(res, 'content_block_start', {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id: `toolu_${id}_${i}`, name: call.name, input: {} },
    })
    event(res, 'content_block_delta', {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) },
    })
    event(res, 'content_block_stop', { type: 'content_block_stop', index })
    index++
  })
  event(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: calls.length > 0 ? 'tool_use' : 'end_turn', stop_sequence: null },
    usage: { output_tokens: 20 },
  })
  event(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

export function toolResults(request) {
  const last = request.messages.at(-1)
  if (!last || !Array.isArray(last.content)) return []
  return last.content
    .filter((block) => block.type === 'tool_result')
    .map((block) => ({
      id: block.tool_use_id,
      isError: block.is_error === true,
      text: Array.isArray(block.content) ? block.content.map((part) => part.text ?? '').join('') : String(block.content ?? ''),
    }))
}

export async function startMockLlm(script) {
  const queue = typeof script === 'function' ? [] : [...script]
  const requests = []
  const sideRequests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    if (req.method === 'POST' && req.url.endsWith('/v1/messages')) {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const sideRequest = !body.tools || body.tools.length === 0
      if (sideRequest) {
        sideRequests.push(body)
        respond(res, { text: 'Mock session title' }, `side_${sideRequests.length}`)
        return
      }
      requests.push(body)
      const step = typeof script === 'function' ? script(body, requests) : (queue.shift() ?? { text: 'script exhausted' })
      respond(res, step, requests.length)
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"type":"error","error":{"type":"not_found_error","message":"mock llm"}}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    sideRequests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
