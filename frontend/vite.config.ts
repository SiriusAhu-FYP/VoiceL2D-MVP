import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import type { ServerResponse } from 'http'
import type { ExpressionInfo, MotionInfo, ResourcesData } from './src/api/live2d-api'

type MotionFileReference = {
  File?: string
  Sound?: string
}

type ExpressionFileReference = {
  Name?: string
  File?: string
}

type ModelJson = {
  FileReferences?: {
    Motions?: Record<string, MotionFileReference[]>
    Expressions?: ExpressionFileReference[]
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'live2d-api',
      configureServer(server) {
        const sseClients = new Set<ServerResponse>();

        const broadcastEvent = (eventType: string, payload: Record<string, unknown>) => {
          const data = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
          for (const client of Array.from(sseClients)) {
            try {
              client.write(data);
            } catch (error) {
              console.error('[Live2D API] Failed to broadcast SSE event', error);
              sseClients.delete(client);
            }
          }
        };

        // 扫描 Resources 文件夹
        function scanResources(): ResourcesData {
          const resourcesPath = join(process.cwd(), 'public/Resources');
          const result: ResourcesData = {
            models: [],
            actions: {},
          };

          if (!existsSync(resourcesPath)) {
            return result;
          }

          const models = readdirSync(resourcesPath).filter(item => {
            const itemPath = join(resourcesPath, item);
            return statSync(itemPath).isDirectory() && !item.startsWith('.');
          });

          result.models = models;

          for (const model of models) {
            const modelPath = join(resourcesPath, model);
            const modelJsonPath = join(modelPath, `${model}.model3.json`);

            if (!existsSync(modelJsonPath)) {
              continue;
            }

            try {
              const modelJson = JSON.parse(readFileSync(modelJsonPath, 'utf-8')) as ModelJson;
              const motions: MotionInfo[] = [];
              const expressions: ExpressionInfo[] = [];
              const sounds: string[] = [];

              // 扫描 sounds 文件夹
              const soundsPath = join(modelPath, 'sounds');
              if (existsSync(soundsPath)) {
                try {
                  const soundFiles = readdirSync(soundsPath).filter(file =>
                    file.endsWith('.wav') || file.endsWith('.mp3') || file.endsWith('.ogg')
                  );
                  sounds.push(...soundFiles.map(file => `sounds/${file}`));
                } catch (error) {
                  console.error(`Error scanning sounds for ${model}:`, error);
                }
              }

              const motionReferences = modelJson.FileReferences?.Motions ?? {};
              for (const [group, motionList] of Object.entries(motionReferences)) {
                if (!Array.isArray(motionList)) {
                  continue;
                }
                motionList.forEach((motion, index) => {
                  if (motion?.File) {
                    motions.push({
                      group,
                      name: `${group}_${index}`,
                      file: motion.File,
                      sound: motion.Sound,
                    });
                  }
                });
              }

              const expressionReferences = modelJson.FileReferences?.Expressions ?? [];
              expressionReferences.forEach((expr) => {
                if (expr?.Name && expr?.File) {
                  expressions.push({
                    name: expr.Name,
                    file: expr.File,
                  });
                }
              });

              result.actions[model] = { motions, expressions, sounds };
            } catch (error) {
              console.error(`Error parsing ${modelJsonPath}:`, error);
            }
          }

          return result;
        }

        // API中间件 - 必须在其他中间件之前
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';
          const pathname = url.split('?')[0];

          if (req.method === 'GET' && pathname === '/api/live2d/events') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            });
            res.write('\n');
            sseClients.add(res);

            const keepAlive = setInterval(() => {
              try {
                res.write('event: ping\ndata: {}\n\n');
              } catch (error) {
                console.error('[Live2D API] SSE keep-alive failed', error);
                clearInterval(keepAlive);
                sseClients.delete(res);
              }
            }, 30000);

            req.on('close', () => {
              clearInterval(keepAlive);
              sseClients.delete(res);
            });
            return;
          }

          // GET /api/live2d/actions
          if (req.method === 'GET' && pathname === '/api/live2d/actions') {
            console.log('[Live2D API] GET /api/live2d/actions');
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            const data = scanResources();
            res.end(JSON.stringify({ success: true, data }));
            return;
          }

          // POST /api/live2d/play
          if (req.method === 'POST' && pathname === '/api/live2d/play') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                const { action, sound } = JSON.parse(body);
                broadcastEvent('action', { action, sound });
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ success: true, message: `Playing: ${action}` }));
              } catch (error) {
                console.error('[Live2D API] Invalid action payload', error);
                res.statusCode = 400;
                res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
              }
            });
            return;
          }

          // POST /api/live2d/expression
          if (req.method === 'POST' && pathname === '/api/live2d/expression') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                const { expression } = JSON.parse(body);
                broadcastEvent('expression', { expression });
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ success: true, message: `Playing expression: ${expression}` }));
              } catch (error) {
                console.error('[Live2D API] Invalid expression payload', error);
                res.statusCode = 400;
                res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
              }
            });
            return;
          }

          // POST /api/live2d/sound
          if (req.method === 'POST' && pathname === '/api/live2d/sound') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                const { sound } = JSON.parse(body);
                broadcastEvent('sound', { sound });
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ success: true, message: `Playing sound: ${sound}` }));
              } catch (error) {
                console.error('[Live2D API] Invalid sound payload', error);
                res.statusCode = 400;
                res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
              }
            });
            return;
          }

          next();
        });

      },
    },
  ],
  server: {
    port: 7788,
  },
})
