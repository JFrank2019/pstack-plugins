import http from 'node:http'

const USAGE = { input_tokens: 0, input_tokens_details: null, output_tokens: 0, output_tokens_details: null, total_tokens: 0 }

function frame(event) {
  return Object.keys(event).length === 1 ? `event: ${event.type}\n\n` : `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

function eventsFor(step, id) {
  const events = [{ type: 'response.created', response: { id } }]
  if (step.text !== undefined) {
    events.push({
      type: 'response.output_item.done',
      item: { type: 'message', role: 'assistant', id: `msg_${id}`, content: [{ type: 'output_text', text: step.text }] },
    })
  }
  ;(step.calls ?? []).forEach((call, index) => {
    const callId = call.id ?? `call_${id}_${index}`
    let item
    if (call.name === 'tool_search') {
      item = { type: 'tool_search_call', call_id: callId, execution: 'client', arguments: call.arguments ?? {} }
    } else if (call.custom) {
      item = { type: 'custom_tool_call', call_id: callId, name: call.name, input: call.arguments }
    } else {
      item = {
        type: 'function_call',
        call_id: callId,
        ...(call.namespace ? { namespace: call.namespace } : {}),
        name: call.name,
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
      }
    }
    events.push({ type: 'response.output_item.done', item })
  })
  events.push({ type: 'response.completed', response: { id, usage: USAGE } })
  return events
}

async function respond(res, step, id) {
  if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs))
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const event of eventsFor(step, id)) res.write(frame(event))
  res.end()
}

function textOf(content) {
  if (typeof content === 'string') return content
  return (content ?? []).map((part) => part.text ?? '').join('')
}

// Flattens the Responses API `input` array into { role, text } rows for messages and keeps tool items intact.
export function inputRows(request) {
  return (request.input ?? []).map((item) =>
    item.type === 'message' || item.role ? { kind: 'message', role: item.role, text: textOf(item.content) } : { kind: item.type, item },
  )
}

export function toolNames(request) {
  const names = []
  for (const tool of request.tools ?? []) {
    if (tool.type === 'namespace') for (const inner of tool.tools ?? []) names.push(`${tool.name}.${inner.name}`)
    else names.push(tool.name ?? tool.type)
  }
  return names
}

export function findTool(request, name) {
  for (const tool of request.tools ?? []) {
    if (tool.type === 'namespace') {
      const inner = (tool.tools ?? []).find((candidate) => candidate.name === name || `${tool.name}.${candidate.name}` === name)
      if (inner) return inner
    } else if (tool.name === name) return tool
  }
  return undefined
}

// Tool outputs the model received in a request, keyed by call id.
export function toolOutputs(request) {
  const out = new Map()
  for (const item of request.input ?? []) {
    if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
      out.set(item.call_id, typeof item.output === 'string' ? item.output : JSON.stringify(item.output))
    } else if (item.type === 'tool_search_output') {
      out.set(item.call_id, JSON.stringify(item.tools ?? item))
    }
  }
  return out
}

// A scripted stand-in for the Responses API. `script` is an array of steps or a function (body, requests) => step.
// A step is { text?, calls?: [{ name, namespace?, arguments, id? }], delayMs? }.
export async function startMockResponses(script) {
  const queue = typeof script === 'function' ? [] : [...script]
  const requests = []
  const other = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks)
    if (req.method === 'POST' && req.url.split('?')[0].endsWith('/responses')) {
      const body = JSON.parse(raw.toString('utf8'))
      requests.push(body)
      const step = typeof script === 'function' ? script(body, requests) : (queue.shift() ?? { text: 'script exhausted' })
      await respond(res, step, `resp_${requests.length}`)
      return
    }
    other.push({ method: req.method, url: req.url })
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":{"message":"mock responses api","type":"not_found"}}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    other,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
