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

**注意：** 声音文件路径相对于模型文件夹（如 `sounds/haru_talk_13.wav` 对应 `/Resources/Haru/sounds/haru_talk_13.wav`）

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
```

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

