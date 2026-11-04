// S2.1 spike: the smallest MCP stdio server whose one tool asks the client for input.
import { createInterface } from 'node:readline'

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
let pendingCall

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'spike', version: '0.0.0' }
      }
    })
  } else if (message.method === 'tools/list') {
    send({
      id: message.id,
      result: {
        tools: [
          {
            name: 'ask',
            description: 'Asks the user a question.',
            inputSchema: { type: 'object', properties: {} }
          }
        ]
      }
    })
  } else if (message.method === 'tools/call') {
    pendingCall = message.id
    send({
      id: 'elicit-1',
      method: 'elicitation/create',
      params: {
        message: 'Spike question',
        requestedSchema: {
          type: 'object',
          properties: { answer: { type: 'string', title: 'Answer' } },
          required: ['answer']
        }
      }
    })
  } else if (message.id === 'elicit-1') {
    send({
      id: pendingCall,
      result: { content: [{ type: 'text', text: `Action: ${String(message.result?.action)}` }] }
    })
  } else if (message.id !== undefined && message.method !== undefined) {
    send({ id: message.id, error: { code: -32601, message: 'Not implemented' } })
  }
})
