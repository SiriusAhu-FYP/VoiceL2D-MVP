# Live2D 动作控制 API 文档

## 概述

本项目提供了HTTP API接口来控制Live2D模型的动作、表情和声音播放。动作、表情和声音列表会动态从`public/Resources`文件夹中扫描获取。

## API 端点

### 1. 获取动作列表

**GET** `/api/live2d/actions`

返回所有模型的动作、表情和声音列表。

**响应示例：**
```json
{
  "success": true,
  "data": {
    "models": ["Mao", "Haru", "Hiyori", ...],
    "actions": {
      "Mao": {
        "motions": [
          {
            "group": "Idle",
            "name": "Idle_0",
            "file": "motions/mtn_01.motion3.json"
          },
          {
            "group": "TapBody",
            "name": "TapBody_0",
            "file": "motions/mtn_02.motion3.json"
          }
        ],
        "expressions": [
          {
            "name": "exp_01",
            "file": "expressions/exp_01.exp3.json"
          }
        ],
        "sounds": [
          "sounds/haru_talk_13.wav",
          "sounds/haru_Info_04.wav"
        ]
      }
    }
  }
}
```

### 2. 播放动作

**POST** `/api/live2d/play`

播放指定的动作。

**请求体：**
```json
{
  "action": "TapBody",
  "sound": "sounds/sound.wav"  // 可选
}
```

**响应示例：**
```json
{
  "success": true,
  "message": "Playing: TapBody"
}
```

### 3. 播放表情

**POST** `/api/live2d/expression`

播放指定的表情。

**请求体：**
```json
{
  "expression": "exp_01"
}
```

**响应示例：**
```json
{
  "success": true,
  "message": "Playing expression: exp_01"
}
```

### 4. 播放声音

**POST** `/api/live2d/sound`

独立播放声音文件（不播放动作）。

**请求体：**
```json
{
  "sound": "sounds/haru_talk_13.wav"
}
```

**响应示例：**
```json
{
  "success": true,
  "message": "Playing sound: sounds/haru_talk_13.wav"
}
```

**注意：** 声音文件路径相对于模型文件夹（如 sounds/haru_talk_13.wav 对应 /Resources/Haru/sounds/haru_talk_13.wav）

### 5. 获取当前模型状态

**GET** /api/live2d/state

返回保存在前端服务侧的当前模型信息，包括当前角色名、所有可用模型以及该角色的动作/表情/音频资源。

**响应示例**
`json
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
`

### 6. 更新当前模型状态

**POST** /api/live2d/state

用于由前端 UI 将最新的模型选择状态同步给其他客户端或脚本，方便外部实时查询。

**请求体：**
`json
{
  "currentModel": "Haru"
}
`

**响应示例**
`json
{
  "success": true,
  "message": "Current model updated"
}
`

### 7. 按索引播放动作

**POST** /api/live2d/motion/index

根据动作列表索引播放对应动作，并自动广播 SSE 事件。

**请求体：**
`json
{
  "index": 0
}
`

**响应示例：**
`json
{
  "success": true,
  "data": {
    "group": "TapBody",
    "name": "TapBody_0",
    "file": "motions/haru_g_m01.motion3.json",
    "sound": "sounds/haru_talk_13.wav"
  }
}
`

### 8. 随机动作

**POST** /api/live2d/random/motion

随机返回一个与上次不同的动作，并触发播放。

### 9. 随机表情

**POST** /api/live2d/random/expression

随机返回一个与上次不同的表情，并触发播放。

### 10. 随机声音

**POST** /api/live2d/random/sound

随机返回一个与上次不同的声音，并触发播放。

### 11. 随机组合

**POST** /api/live2d/random/combo

一次性随机触发“动作 + 表情 + 声音”组合，确保与上次组合不同。

### 12. 资源合法性校验

**POST** /api/live2d/validate

校验指定动作/表情/声音是否存在于当前模型。

**请求体：**
`json
{
  "type": "expression",
  "value": "F01"
}
`

**响应示例：**
`json
{
  "success": true,
  "data": {
    "type": "expression",
    "value": "F01",
    "valid": true
  }
}
`

### 13. 切换模型

**POST** /api/live2d/switch-model

切换到指定的 Live2D 模型。支持普通模型和 VTuber Studio 商业模型。

**请求体：**
```json
{
  "modelName": "Haru"
}
```

**响应示例：**
```json
{
  "success": true,
  "message": "Model switched successfully",
  "data": {
    "modelName": "Haru",
    "modelPath": "/Resources/Commercial_models/Haru/Haru.model3.json"
  }
}
```

**说明：**
- 切换模型会触发 SSE `modelSwitch` 事件，所有连接的客户端会接收到通知
- 模型会自动从以下位置扫描：
  - 普通模型：`/Resources/{modelName}/`
  - 商业模型：`/Resources/Commercial_models/{modelName}/`
- VTuber Studio 模型会自动识别（包含 `.vtube.json` 文件）
- VTuber Studio 模型的表情和动作会自动从根目录扫描


## 使用示例

### cURL 示例

```bash
# 获取动作列表
curl http://localhost:7788/api/live2d/actions

# 播放动作
curl -X POST http://localhost:7788/api/live2d/play \
  -H "Content-Type: application/json" \
  -d '{"action": "TapBody"}'

# 播放带声音的动作
curl -X POST http://localhost:7788/api/live2d/play \
  -H "Content-Type: application/json" \
  -d '{"action": "TapBody", "sound": "sounds/haru_talk_13.wav"}'

# 播放表情
curl -X POST http://localhost:7788/api/live2d/expression \
  -H "Content-Type: application/json" \
  -d '{"expression": "exp_01"}'

# 播放声音
curl -X POST http://localhost:7788/api/live2d/sound \
  -H "Content-Type: application/json" \
  -d '{"sound": "sounds/haru_talk_13.wav"}'

# 获取当前模型状态
curl http://localhost:7788/api/live2d/state

# 切换模型
curl -X POST http://localhost:7788/api/live2d/switch-model \
  -H "Content-Type: application/json" \
  -d '{"modelName": "Haru"}'

# 更新当前模型
curl -X POST http://localhost:7788/api/live2d/state \
  -H "Content-Type: application/json" \
  -d '{"currentModel": "Haru"}'
``
# 随机动作
curl -X POST http://localhost:7788/api/live2d/random/motion

# 随机组合
curl -X POST http://localhost:7788/api/live2d/random/combo

# 资源校验
curl -X POST http://localhost:7788/api/live2d/validate \
  -H "Content-Type: application/json" \
  -d '{"type": "expression", "value": "F01"}'
`

### JavaScript 示例

```javascript
// 获取动作列表
const response = await fetch('/api/live2d/actions');
const data = await response.json();
console.log(data.data);

// 播放动作
await fetch('/api/live2d/play', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'TapBody' })
});

// 播放带声音的动作
await fetch('/api/live2d/play', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    action: 'TapBody',
    sound: 'sounds/haru_talk_13.wav'
  })
});

// 播放表情
await fetch('/api/live2d/expression', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ expression: 'exp_01' })
});

// 播放声音
await fetch('/api/live2d/sound', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sound: 'sounds/haru_talk_13.wav' })
});
// 获取当前模型状态
const stateResponse = await fetch('/api/live2d/state');
const state = await stateResponse.json();
console.log(state.data.currentModel);

// 更新当前模型状态
await fetch('/api/live2d/state', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ currentModel: 'Haru' })
});

// 随机动作
await fetch('/api/live2d/random/motion', { method: 'POST' });

// 随机组合
await fetch('/api/live2d/random/combo', { method: 'POST' });

// 资源校验
const validateResponse = await fetch('/api/live2d/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'expression', value: 'F01' })
});
const validateResult = await validateResponse.json();
console.log(validateResult.data.valid);
```

## 前端界面

在网页右下角有一个动作控制浮窗，包含：
- 切换按钮：显示/隐藏动作面板
- 动作按钮：按组分类显示所有可用动作
- 表情按钮：显示所有可用表情
- 声音按钮：显示所有可用声音文件（如果有）

点击按钮即可播放对应的动作、表情或声音。

## 注意事项

1. API服务器在Vite开发服务器中运行，端口为7788
2. 动作组名称需要匹配模型文件中的定义（如"TapBody"、"Idle"等）
3. 声音文件路径相对于模型文件夹（如`sounds/haru_talk_13.wav` 对应 `/Resources/Haru/sounds/haru_talk_13.wav`）
4. 如果动作带有声音，会自动播放相应的音频文件
5. 声音文件支持格式：`.wav`、`.mp3`、`.ogg`
6. 声音列表会自动扫描每个模型文件夹下的`sounds`子文件夹

