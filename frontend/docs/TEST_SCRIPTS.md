# Live2D API 测试脚本文档

本目录包含多个测试脚本，用于测试Live2D API的各项功能。所有脚本都使用Node.js编写，无需额外依赖。

## 公共参数

所有测试脚本均支持以下可选参数，用于在开发端口变更或代理环境下快速切换连接目标：

- `--port` 或 `-p`：指定前端开发服务器端口（默认 `7788`）。示例：`node test_motion.js 2 --port 8080`
- `--api-base <url>`：直接指定完整的 API 根地址，例如 `http://127.0.0.1:9000`

也可以通过环境变量覆盖：

- `LIVE2D_API_BASE`：优先级最高的完整 API 地址
- `FRONTEND_PORT` / `VITE_PORT` / `LIVE2D_PORT`：作为默认端口的候选

## 前置条件

1. 确保开发服务器正在运行：
```bash
pnpm dev
```

2. 服务器默认运行在 `http://localhost:7788`

## 测试脚本列表

### 1. test_motion.js - 动作测试

测试Live2D模型的动作播放功能。

**使用方法：**
```bash
# 列出所有动作
node test_motion.js

# 执行指定索引的动作（默认使用Haru模型）
node test_motion.js 3

# 执行指定模型的动作
node test_motion.js 3 Haru
```

**功能：**
- 列出所有动作及其详细信息（分组、文件、声音等）
- 执行指定索引的动作
- 自动播放动作关联的声音文件

**输出示例：**
```
🎭 Live2D 动作测试工具

📡 正在连接服务器...
✅ 成功连接到服务器

📋 可用模型: Haru, Hiyori, Mao, Mark, Natori, Rice, Wanko

🎨 模型: Haru
📊 动作数量: 27

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
动作列表:

[0] Idle_0
    分组: Idle
    文件: motions/haru_g_idle.motion3.json
    声音: 🔇 无声音

[1] TapBody_0
    分组: TapBody
    文件: motions/haru_g_m01.motion3.json
    声音: 🔊 sounds/haru_talk_13.wav

...

🎬 正在执行动作 [3]: TapBody_3
   分组: TapBody
   声音: sounds/haru_Info_04.wav
✅ 动作执行成功！

💡 提示: 请在浏览器中查看Live2D模型的动作效果
```

---

### 2. test_expression.js - 表情测试

测试Live2D模型的表情播放功能。

**使用方法：**
```bash
# 列出所有表情
node test_expression.js

# 执行指定索引的表情（默认使用Haru模型）
node test_expression.js 2

# 执行指定模型的表情
node test_expression.js 2 Haru
```

**功能：**
- 列出所有表情及其详细信息
- 执行指定索引的表情

**输出示例：**
```
😊 Live2D 表情测试工具

📡 正在连接服务器...
✅ 成功连接到服务器

📋 可用模型: Haru, Hiyori, Mao, Mark, Natori, Rice, Wanko

🎨 模型: Haru
📊 表情数量: 8

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
表情列表:

[0] F01
    文件: expressions/F01.exp3.json

[1] F02
    文件: expressions/F02.exp3.json

...

😊 正在执行表情 [2]: F03
✅ 表情执行成功！

💡 提示: 请在浏览器中查看Live2D模型的表情效果
```

---

### 3. test_sound.js - 声音测试

测试Live2D模型的声音播放功能。

**使用方法：**
```bash
# 列出所有声音
node test_sound.js

# 播放指定索引的声音（默认使用Haru模型）
node test_sound.js 1

# 播放指定模型的声音
node test_sound.js 1 Haru
```

**功能：**
- 列出所有可用声音文件
- 播放指定索引的声音

**输出示例：**
```
🔊 Live2D 声音测试工具

📡 正在连接服务器...
✅ 成功连接到服务器

📋 可用模型: Haru, Hiyori, Mao, Mark, Natori, Rice, Wanko

🎨 模型: Haru
📊 声音数量: 4

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
声音列表:

[0] haru_Info_04.wav
    路径: sounds/haru_Info_04.wav

[1] haru_Info_14.wav
    路径: sounds/haru_Info_14.wav

...

🔊 正在播放声音 [1]: haru_Info_14.wav
   路径: sounds/haru_Info_14.wav
✅ 声音播放成功！

💡 提示: 请在浏览器中听Live2D模型播放的声音
```

---

### 4. test_models.js - 模型信息查看

查看所有模型的详细信息。

**使用方法：**
```bash
# 列出所有模型概览
node test_models.js

# 显示指定模型的详细信息
node test_models.js Haru
```

**功能：**
- 列出所有可用模型
- 显示每个模型的动作、表情、声音数量
- 查看指定模型的详细信息（按分组显示）

**输出示例（概览）：**
```
🎭 Live2D 模型信息工具

📡 正在连接服务器...
✅ 成功连接到服务器

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Live2D 模型概览

总计: 7 个模型

[0] Haru
    动作: 27 | 表情: 8 | 声音: 4

[1] Hiyori
    动作: 10 | 表情: 0 | 声音: 0

...
```

**输出示例（详细）：**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 模型: Haru

📊 动作 (27):

  分组: Idle (1 个动作)
    [0] Idle_0 🔇

  分组: TapBody (26 个动作)
    [0] TapBody_0 🔊
    [1] TapBody_1 🔊
    ...

😊 表情 (8):

  [0] F01
  [1] F02
  ...

🔊 声音 (4):

  [0] haru_Info_04.wav
  [1] haru_Info_14.wav
  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 测试命令:
   node test_motion.js 0 Haru      # 播放第0个动作
   node test_expression.js 0 Haru  # 播放第0个表情
   node test_sound.js 0 Haru       # 播放第0个声音
```

---

### 5. test_api.js - API集成测试

完整的API测试套件，测试所有API端点。

**使用方法：**
```bash
# 运行完整测试
node test_api.js

# 仅列出资源
node test_api.js list

# 仅测试动作
node test_api.js motion

# 仅测试表情
node test_api.js expression

# 仅测试声音
node test_api.js sound
```

**功能：**
- 测试所有API端点的连通性
- 测试动作、表情、声音的播放功能
- 显示测试结果统计

**输出示例：**
```
🧪 Live2D API 测试套件

📡 测试: GET /api/live2d/actions
✅ 成功获取动作列表

使用模型: Haru

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 测试: POST /api/live2d/play (动作: Idle)
✅ 动作播放成功

📡 测试: POST /api/live2d/expression (表情: F01)
✅ 表情播放成功

📡 测试: POST /api/live2d/sound (声音: sounds/haru_Info_04.wav)
✅ 声音播放成功

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

测试完成: 3/3 通过
🎉 所有测试通过！

💡 提示: 请在浏览器中查看Live2D模型的实际效果
```

---

## API端点说明

### GET /api/live2d/actions

获取所有模型的动作、表情和声音列表。

**响应格式：**
```json
{
  "success": true,
  "data": {
    "models": ["Haru", "Hiyori", ...],
    "actions": {
      "Haru": {
        "motions": [
          {
            "group": "Idle",
            "name": "Idle_0",
            "file": "motions/haru_g_idle.motion3.json",
            "sound": "sounds/haru_talk_13.wav"
          }
        ],
        "expressions": [
          {
            "name": "F01",
            "file": "expressions/F01.exp3.json"
          }
        ],
        "sounds": [
          "sounds/haru_Info_04.wav"
        ]
      }
    }
  }
}
```

### POST /api/live2d/play

播放指定的动作。

**请求体：**
```json
{
  "action": "TapBody",
  "sound": "sounds/sound.wav"  // 可选
}
```

### POST /api/live2d/expression

播放指定的表情。

**请求体：**
```json
{
  "expression": "F01"
}
```

### POST /api/live2d/sound

播放指定的声音。

**请求体：**
```json
{
  "sound": "sounds/haru_talk_13.wav"
}
```


### GET /api/live2d/state

获取当前前端服务保存的模型状态，包括当前角色名称、可用的动作表情、音频资源列表、以及所有常用的模型。

**响应格式：**
```json
{
  "success": true,
  "data": {
    "currentModel": "Haru",
    "models": ["Mao", "Haru", "Hiyori"],
    "availableActions": {
      "motions": [],
      "expressions": [],
      "sounds": []
    },
    "updatedAt": "2025-11-26T15:57:00.000Z"
  }
}
```

### POST /api/live2d/state

通过前端画面UI更新当前显示的模型状态，方便其他查询客户端实时获取同一份信息。

**请求体：**
```json
{
  "currentModel": "Haru"
}
```


---

## 常见问题

### 1. 连接失败

**错误信息：**
```
❌ 错误: connect ECONNREFUSED 127.0.0.1:7788
提示: 请确保开发服务器正在运行 (pnpm dev)
```

**解决方法：**
- 确保已启动开发服务器：`pnpm dev`
- 检查端口7788是否被占用

### 2. 模型不存在

**错误信息：**
```
❌ 模型 "XXX" 不存在
可用模型: Haru, Hiyori, Mao, Mark, Natori, Rice, Wanko
```

**解决方法：**
- 使用 `node test_models.js` 查看所有可用模型
- 确保模型名称拼写正确（区分大小写）

### 3. 索引超出范围

**错误信息：**
```
❌ 动作索引 10 超出范围 (0-9)
```

**解决方法：**
- 先运行脚本不带索引参数，查看有效范围
- 确保索引从0开始计数

---

## 快速开始示例

```bash
# 1. 启动开发服务器
pnpm dev

# 2. 在新终端中运行测试

# 查看所有模型
node test_models.js

# 查看Haru模型的详细信息
node test_models.js Haru

# 播放Haru的第3个动作
node test_motion.js 3 Haru

# 播放Haru的第1个表情
node test_expression.js 1 Haru

# 播放Haru的第0个声音
node test_sound.js 0 Haru

# 运行完整API测试
node test_api.js
```

---

## 注意事项

1. **所有测试脚本都需要开发服务器运行**
   - 运行测试前确保执行了 `pnpm dev`

2. **效果需在浏览器中查看**
   - 测试脚本仅发送API请求
   - 实际的动作、表情、声音效果需要打开 http://localhost:7788 查看

3. **索引从0开始**
   - 所有的动作、表情、声音索引都从0开始计数

4. **模型名称区分大小写**
   - 使用正确的模型名称（如 `Haru` 而不是 `haru`）

5. **声音文件路径**
   - 声音路径相对于模型文件夹
   - 格式：`sounds/filename.wav`

---

## 技术说明

### 依赖
- Node.js 内置 `http` 模块（无需额外安装依赖）

### API服务器
- 基于Vite开发服务器的自定义中间件
- 端口：7788
- 支持CORS

### 资源扫描
- 自动扫描 `public/Resources` 文件夹
- 解析 `.model3.json` 文件获取动作和表情信息
- 扫描 `sounds` 子文件夹获取声音文件列表

---

## 开发者提示

如果需要自定义测试脚本，可以参考以下代码模板：

```javascript
const http = require('http');

const API_BASE = 'http://localhost:7788';

function request(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        });
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

// 使用示例
async function test() {
    // GET请求
    const data = await request(`${API_BASE}/api/live2d/actions`);
    
    // POST请求
    const result = await request(`${API_BASE}/api/live2d/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'TapBody' }),
    });
}
```


