import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'live2d-api',
      configureServer(server) {
        // 全局存储播放回调
        const callbacks = {
          playAction: null as ((action: string, sound?: string) => void) | null,
          playExpression: null as ((expression: string) => void) | null,
          playSound: null as ((sound: string) => void) | null,
        };

        // 扫描Resources文件夹
        function scanResources() {
          const resourcesPath = join(process.cwd(), 'public/Resources');
          const result: any = {
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

            if (existsSync(modelJsonPath)) {
              try {
                const modelJson = JSON.parse(readFileSync(modelJsonPath, 'utf-8'));
                const motions: any[] = [];
                const expressions: any[] = [];
                const sounds: string[] = [];

                // 扫描sounds文件夹
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

                if (modelJson.FileReferences?.Motions) {
                  for (const [group, motionList] of Object.entries(modelJson.FileReferences.Motions)) {
                    if (Array.isArray(motionList)) {
                      motionList.forEach((motion: any, index: number) => {
                        motions.push({
                          group,
                          name: `${group}_${index}`,
                          file: motion.File,
                          sound: motion.Sound,
                        });
                      });
                    }
                  }
                }

                if (modelJson.FileReferences?.Expressions) {
                  modelJson.FileReferences.Expressions.forEach((expr: any) => {
                    expressions.push({
                      name: expr.Name,
                      file: expr.File,
                    });
                  });
                }

                result.actions[model] = { motions, expressions, sounds };
              } catch (error) {
                console.error(`Error parsing ${modelJsonPath}:`, error);
              }
            }
          }

          return result;
        }

        // API中间件 - 必须在其他中间件之前
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';
          const pathname = url.split('?')[0];

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
                if (callbacks.playAction) {
                  callbacks.playAction(action, sound);
                }
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ success: true, message: `Playing: ${action}` }));
              } catch (error) {
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
                if (callbacks.playExpression) {
                  callbacks.playExpression(expression);
                }
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ success: true, message: `Playing expression: ${expression}` }));
              } catch (error) {
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
                if (callbacks.playSound) {
                  callbacks.playSound(sound);
                }
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ success: true, message: `Playing sound: ${sound}` }));
              } catch (error) {
                res.statusCode = 400;
                res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
              }
            });
            return;
          }

          next();
        });

        // 暴露回调设置函数到全局
        (global as any).__live2dSetCallbacks = (playAction: any, playExpression: any, playSound: any) => {
          callbacks.playAction = playAction;
          callbacks.playExpression = playExpression;
          callbacks.playSound = playSound;
        };
      },
    },
  ],
  server: {
    port: 7788,
  },
})
