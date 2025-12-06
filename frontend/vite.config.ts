import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import type { ServerResponse } from 'http'
import { live2dStateManager } from './server/live2dState'
import type { ResourcesData } from './src/api/live2d-api'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const sendJson = (res: ServerResponse, payload: unknown, status = 200) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.end(JSON.stringify(payload))
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'live2d-api',
      configureServer(server) {
        const sseClients = new Set<ServerResponse>()

        const broadcastEvent = (eventType: string, payload: Record<string, unknown>) => {
          const data = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`
          for (const client of Array.from(sseClients)) {
            try {
              client.write(data)
            } catch (error) {
              console.error('[Live2D API] Failed to broadcast SSE event', error)
              sseClients.delete(client)
            }
          }
        }

        server.middlewares.use((req, res, next) => {
          const url = req.url || ''
          const pathname = url.split('?')[0]

          // Serve asset files from parent directory
          if (req.method === 'GET' && pathname.startsWith('/asset/')) {
            const assetPath = join(__dirname, '..', pathname)
            if (existsSync(assetPath)) {
              const content = readFileSync(assetPath)
              const ext = pathname.split('.').pop()?.toLowerCase()
              const mimeTypes: Record<string, string> = {
                'wav': 'audio/wav',
                'mp3': 'audio/mpeg',
                'ogg': 'audio/ogg',
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
              }
              res.statusCode = 200
              res.setHeader('Content-Type', mimeTypes[ext || ''] || 'application/octet-stream')
              res.setHeader('Access-Control-Allow-Origin', '*')
              res.end(content)
              return
            }
          }

          if (req.method === 'GET' && pathname === '/api/live2d/events') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            })
            res.write('\n')
            sseClients.add(res)

            const keepAlive = setInterval(() => {
              try {
                res.write('event: ping\ndata: {}\n\n')
              } catch (error) {
                console.error('[Live2D API] SSE keep-alive failed', error)
                clearInterval(keepAlive)
                sseClients.delete(res)
              }
            }, 30000)

            req.on('close', () => {
              clearInterval(keepAlive)
              sseClients.delete(res)
            })
            return
          }

          if (req.method === 'GET' && pathname === '/api/live2d/actions') {
            console.log('[Live2D API] GET /api/live2d/actions')
            const data: ResourcesData = live2dStateManager.getResourcesSnapshot()
            sendJson(res, { success: true, data })
            return
          }

          if (req.method === 'GET' && pathname === '/api/live2d/state') {
            console.log('[Live2D API] GET /api/live2d/state')
            const data = live2dStateManager.getResourcesSnapshot()
            const resolvedModel = live2dStateManager.getCurrentModelName()
            const availableActions = resolvedModel ? data.actions[resolvedModel] ?? null : null
            sendJson(res, {
              success: true,
              data: {
                currentModel: resolvedModel,
                availableActions,
                models: data.models,
                updatedAt: live2dStateManager.getLastModelUpdateISO(),
              },
            })
            return
          }

          if (req.method === 'GET' && pathname.startsWith('/api/live2d/model-path/')) {
            const modelName = decodeURIComponent(pathname.replace('/api/live2d/model-path/', ''))
            console.log(`[Live2D API] GET /api/live2d/model-path/${modelName}`)
            const metadata = live2dStateManager.getModelMetadata(modelName)
            if (metadata) {
              sendJson(res, {
                success: true,
                data: { path: `${metadata.path}/${modelName}.model3.json` }
              })
            } else {
              sendJson(res, { success: false, error: 'Model not found' }, 404)
            }
            return
          }

          if (req.method === 'POST' && pathname === '/api/live2d/play') {
            let body = ''
            req.on('data', chunk => {
              body += chunk.toString()
            })
            req.on('end', () => {
              try {
                const { action, sound } = JSON.parse(body)
                broadcastEvent('action', { action, sound })
                if (typeof action === 'string') {
                  const matchedMotion = live2dStateManager.findMotionByGroup(action)
                  live2dStateManager.recordMotion(matchedMotion ?? null, typeof sound === 'string' ? sound : undefined)
                }
                sendJson(res, { success: true, message: `Playing: ${action}` })
              } catch (error) {
                console.error('[Live2D API] Invalid action payload', error)
                sendJson(res, { success: false, error: 'Invalid request' }, 400)
              }
            })
            return
          }

          if (req.method === 'POST' && pathname === '/api/live2d/expression') {
            let body = ''
            req.on('data', chunk => {
              body += chunk.toString()
            })
            req.on('end', () => {
              try {
                const { expression } = JSON.parse(body)
                broadcastEvent('expression', { expression })
                if (typeof expression === 'string') {
                  const matched = live2dStateManager.findExpressionByName(expression)
                  live2dStateManager.recordExpression(matched ?? expression)
                }
                sendJson(res, { success: true, message: `Playing expression: ${expression}` })
              } catch (error) {
                console.error('[Live2D API] Invalid expression payload', error)
                sendJson(res, { success: false, error: 'Invalid request' }, 400)
              }
            })
            return
          }

          if (req.method === 'POST' && pathname === '/api/live2d/sound') {
            let body = ''
            req.on('data', chunk => {
              body += chunk.toString()
            })
            req.on('end', () => {
              try {
                const { sound } = JSON.parse(body)
                broadcastEvent('sound', { sound })
                if (typeof sound === 'string') {
                  live2dStateManager.recordSound(sound)
                }
                sendJson(res, { success: true, message: `Playing sound: ${sound}` })
              } catch (error) {
                console.error('[Live2D API] Invalid sound payload', error)
                sendJson(res, { success: false, error: 'Invalid request' }, 400)
              }
            })
            return
          }

          if (req.method === 'POST' && pathname === '/api/live2d/state') {
            let body = ''
            req.on('data', chunk => {
              body += chunk.toString()
            })
            req.on('end', () => {
              try {
                const payload = JSON.parse(body) as { currentModel?: unknown }
                if (typeof payload.currentModel !== 'string' || payload.currentModel.trim() === '') {
                  throw new Error('Invalid currentModel')
                }
                const success = live2dStateManager.setCurrentModel(payload.currentModel.trim())
                if (!success) {
                  sendJson(res, { success: false, error: 'Model not found' }, 400)
                  return
                }
                sendJson(res, { success: true, message: 'Current model updated' })
              } catch (error) {
                console.error('[Live2D API] Invalid state payload', error)
                sendJson(res, { success: false, error: 'Invalid request' }, 400)
              }
            })
            return
          }

          if (req.method === 'POST' && pathname === '/api/live2d/switch-model') {
            let body = ''
            req.on('data', chunk => {
              body += chunk.toString()
            })
            req.on('end', () => {
              try {
                const payload = JSON.parse(body) as { modelName?: unknown }
                if (typeof payload.modelName !== 'string' || payload.modelName.trim() === '') {
                  throw new Error('Invalid modelName')
                }
                const modelName = payload.modelName.trim()
                const success = live2dStateManager.setCurrentModel(modelName)
                if (!success) {
                  sendJson(res, { success: false, error: 'Model not found' }, 400)
                  return
                }

                // Get model metadata for path information
                const metadata = live2dStateManager.getModelMetadata(modelName)
                const modelPath = metadata?.path ?? `/Resources/${modelName}`

                // Broadcast model switch event to all connected clients
                broadcastEvent('modelSwitch', {
                  modelName,
                  modelPath: `${modelPath}/${modelName}.model3.json`
                })

                sendJson(res, {
                  success: true,
                  message: 'Model switched successfully',
                  data: {
                    modelName,
                    modelPath: `${modelPath}/${modelName}.model3.json`
                  }
                })
              } catch (error) {
                console.error('[Live2D API] Invalid switch-model payload', error)
                sendJson(res, { success: false, error: 'Invalid request' }, 400)
              }
            })
            return
          }

          if (req.method === 'POST' && pathname === '/api/live2d/motion/index') {
            let body = ''
            req.on('data', chunk => {
              body += chunk.toString()
            })
            req.on('end', () => {
              try {
                const { index } = JSON.parse(body) as { index?: unknown }
                if (typeof index !== 'number') {
                  throw new Error('Invalid index')
                }
                const motion = live2dStateManager.getMotionByIndex(index)
                if (!motion) {
                  sendJson(res, { success: false, error: 'Motion index out of range' }, 400)
                  return
                }
                broadcastEvent('action', { action: motion.group, sound: motion.sound })
                live2dStateManager.recordMotion(motion, motion.sound)
                sendJson(res, { success: true, data: motion })
              } catch (error) {
                console.error('[Live2D API] Invalid motion index payload', error)
                sendJson(res, { success: false, error: 'Invalid request' }, 400)
              }
            })
            return
          }

          if (req.method === 'POST' && pathname === '/api/live2d/random/motion') {
            const result = live2dStateManager.pickRandomMotion()
            if (result.error || !result.motion) {
              sendJson(res, { success: false, error: result.error || 'Unable to pick motion' }, 400)
              return
            }
            broadcastEvent('action', { action: result.motion.group, sound: result.motion.sound })
            sendJson(res, { success: true, data: result.motion })
            return
          }

          if (req.method === 'POST' && pathname === '/api/live2d/random/expression') {
            const result = live2dStateManager.pickRandomExpression()
            if (result.error || !result.expression) {
              sendJson(res, { success: false, error: result.error || 'Unable to pick expression' }, 400)
              return
            }
            broadcastEvent('expression', { expression: result.expression.name })
            sendJson(res, { success: true, data: result.expression })
            return
          }

          if (req.method === 'POST' && pathname === '/api/live2d/random/sound') {
            const result = live2dStateManager.pickRandomSound()
            if (result.error || !result.sound) {
              sendJson(res, { success: false, error: result.error || 'Unable to pick sound' }, 400)
              return
            }
            broadcastEvent('sound', { sound: result.sound })
            sendJson(res, { success: true, data: { sound: result.sound } })
            return
          }

          if (req.method === 'POST' && pathname === '/api/live2d/random/combo') {
            const result = live2dStateManager.pickRandomCombo()
            if ('error' in result) {
              sendJson(res, { success: false, error: result.error }, 400)
              return
            }
            broadcastEvent('action', { action: result.motion.group, sound: result.sound })
            broadcastEvent('expression', { expression: result.expression.name })
            sendJson(res, { success: true, data: result })
            return
          }

          if (req.method === 'POST' && pathname === '/api/live2d/validate') {
            let body = ''
            req.on('data', chunk => {
              body += chunk.toString()
            })
            req.on('end', () => {
              try {
                const payload = JSON.parse(body) as { type?: string; value?: string }
                const { type, value } = payload
                if (!type || !value) {
                  throw new Error('Invalid payload')
                }
                let valid = false
                if (type === 'motion') {
                  valid = !!live2dStateManager.findMotionByGroup(value)
                } else if (type === 'expression') {
                  valid = !!live2dStateManager.findExpressionByName(value)
                } else if (type === 'sound') {
                  valid = live2dStateManager.hasSound(value)
                }
                sendJson(res, { success: true, data: { type, value, valid } })
              } catch (error) {
                console.error('[Live2D API] Invalid validate payload', error)
                sendJson(res, { success: false, error: 'Invalid request' }, 400)
              }
            })
            return
          }

          next()
        })
      },
    },
  ],
  server: {
    port: 7788,
  },
})
