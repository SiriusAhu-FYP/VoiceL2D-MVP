# 商业模型（VTuber Studio）播放问题修复说明

## 问题分析

通过对比商业模型和公开模型的文件结构，发现以下关键差异导致动作和表情播放失败：

### 1. **文件组织结构差异**

**公开模型（Haru）：**
```
Haru/
├── Haru.model3.json          # 完整定义了Motions和Expressions
├── expressions/
│   ├── F01.exp3.json
│   └── F02.exp3.json
└── motions/
    ├── haru_g_idle.motion3.json
    └── haru_g_m26.motion3.json
```

**商业模型（英伦兔兔）：**
```
英伦兔兔/
├── 英伦兔兔.model3.json        # 没有Motions和Expressions定义
├── 英伦兔兔.vtube.json         # VTuber Studio配置
├── angry.exp3.json            # 表情文件直接在根目录
├── Love.exp3.json
├── 123.motion3.json           # 动作文件直接在根目录
└── meme.motion3.json
```

### 2. **model3.json 文件内容差异**

**公开模型的 model3.json：**
```json
{
  "FileReferences": {
    "Moc": "Haru.moc3",
    "Expressions": [
      {"Name": "F01", "File": "expressions/F01.exp3.json"},
      {"Name": "F02", "File": "expressions/F02.exp3.json"}
    ],
    "Motions": {
      "Idle": [
        {"File": "motions/haru_g_idle.motion3.json"}
      ],
      "TapBody": [
        {"File": "motions/haru_g_m26.motion3.json"}
      ]
    }
  }
}
```

**商业模型的 model3.json：**
```json
{
  "FileReferences": {
    "Moc": "英伦兔兔.moc3",
    "Textures": [...],
    "Physics": "英伦兔兔.physics3.json"
    // 注意：没有 Expressions 和 Motions 字段！
  }
}
```

### 3. **参数命名差异**

**公开模型表情文件：**
```json
{
  "Type": "Live2D Expression",
  "Parameters": [
    {"Id": "ParamMouthForm", "Value": 0.27, "Blend": "Add"}
  ]
}
```

**商业模型表情文件：**
```json
{
  "Type": "Live2D Expression",
  "Parameters": [
    {"Id": "Param2", "Value": 1.0, "Blend": "Add"}
  ]
}
```

商业模型使用通用参数ID（Param2, Param11等），而公开模型使用描述性参数ID（ParamMouthForm, ParamAngleX等）。

## 根本原因

**pixi-live2d-display库的加载机制：**
1. 库首先读取 model3.json 文件
2. 根据 FileReferences.Expressions 和 FileReferences.Motions 预加载资源
3. 没有在 model3.json 中声明的文件无法被正确索引和播放

**VTuber Studio 模型的特殊性：**
- 用于 VTuber Studio 软件，该软件有自己的资源加载机制
- 不依赖于 model3.json 中的声明，而是直接扫描目录
- 我们的 Web 应用使用 pixi-live2d-display，需要遵循标准的 Live2D 加载方式

## 解决方案

### 方案一：后端动态注册（已实现）

修改 `frontend/server/live2dState.ts`，在扫描时自动发现并注册所有表情和动作文件：

**关键改动：**
```typescript
// 扫描根目录下的所有 .exp3.json 和 .motion3.json 文件
files.forEach((file) => {
  if (file.endsWith('.motion3.json')) {
    const motionName = file.replace('.motion3.json', '');
    motions.push({
      group: motionName,  // 使用文件名作为组名
      name: motionName,
      file: file,
    });
  }
  
  if (file.endsWith('.exp3.json')) {
    const expressionName = file.replace('.exp3.json', '');
    expressions.push({
      name: expressionName,
      file: file,
    });
  }
});
```

**局限性：** 虽然后端可以扫描并提供文件列表，但 pixi-live2d-display 仍然无法播放未在 model3.json 中声明的资源。

### 方案二：前端播放逻辑改进（已实现）

修改 `frontend/src/components/Live2DComponent.tsx`：

1. **增强的动作播放：**
```typescript
// 尝试按组名播放，失败则尝试按索引播放
modelRef.current.motion(motionGroup, undefined, 3).catch((err) => {
  console.warn(`Motion playback failed for group "${motionGroup}":`, err);
  modelRef.current?.motion(motionGroup, 0, 3).catch((err2) => {
    console.error('Motion playback failed completely:', err2);
  });
});
```

2. **增强的表情播放：**
```typescript
// 尝试播放表情，失败则尝试添加扩展名
modelRef.current.expression(expression).catch((err) => {
  if (!expression.endsWith('.exp3.json')) {
    modelRef.current?.expression(`${expression}.exp3.json`).catch((err2) => {
      console.error('Expression playback failed completely:', err2);
    });
  }
});
```

3. **修复资源路径：**
```typescript
// 根据模型类型确定正确的资源路径
const isCommercialModel = modelNameForAssets === '英伦兔兔';
const basePath = isCommercialModel 
  ? `/Resources/Commercial_models/${modelNameForAssets}` 
  : `/Resources/${modelNameForAssets}`;
```

**局限性：** 仍受限于 pixi-live2d-display 的加载机制。

### 方案三：model3.json 补丁生成（推荐的完整解决方案）

**实现思路：**
1. 在模型加载前，检测是否为 VTuber Studio 模型
2. 如果是，动态生成一个补充的 model3.json 内容
3. 将扫描到的所有表情和动作添加到 FileReferences 中
4. 使用修改后的配置加载模型

**需要实现：**
```typescript
// 在 Live2DComponent 中加载模型前：
async function loadVTuberStudioModel(modelPath: string) {
  // 1. 获取模型目录路径
  const modelDir = modelPath.substring(0, modelPath.lastIndexOf('/'));
  
  // 2. 获取原始 model3.json
  const response = await fetch(modelPath);
  const modelJson = await response.json();
  
  // 3. 扫描表情和动作文件
  const expressionsResponse = await fetch(`${modelDir}/expressions-list.json`);
  const motionsResponse = await fetch(`${modelDir}/motions-list.json`);
  
  // 4. 动态添加到 model3.json
  modelJson.FileReferences.Expressions = expressionsList;
  modelJson.FileReferences.Motions = { "Custom": motionsList };
  
  // 5. 使用修改后的配置加载
  return await Live2DModel.from(modelJson, { modelPath: modelDir });
}
```

## 当前实施状态

### ✅ 已完成

1. **后端扫描增强**
   - 自动检测 VTuber Studio 模型（通过 .vtube.json 文件）
   - 扫描根目录下的所有表情和动作文件
   - 记录模型元数据（路径、类型）

2. **前端播放改进**
   - 增加错误处理和重试机制
   - 修复Commercial_models的资源路径
   - 添加详细的日志输出

3. **UI优化**
   - 模型切换下拉菜单
   - 显示所有可用的表情和动作
   - 切换状态指示

### ⚠️ 当前限制

由于 pixi-live2d-display 的架构限制，VTuber Studio 模型的表情和动作可能仍然**无法正常播放**，除非：
1. 在 model3.json 中声明了这些资源，或
2. 实现方案三的动态补丁机制

### 🔧 临时解决方案

**为了让VTuber Studio模型能够播放，建议：**

#### 选项A：手动修改 model3.json
在 `英伦兔兔.model3.json` 中添加：
```json
{
  "Version": 3,
  "FileReferences": {
    "Moc": "英伦兔兔.moc3",
    "Textures": [...],
    "Physics": "英伦兔兔.physics3.json",
    "DisplayInfo": "英伦兔兔.cdi3.json",
    "Expressions": [
      {"Name": "angry", "File": "angry.exp3.json"},
      {"Name": "Love", "File": "Love.exp3.json"},
      {"Name": "Crying", "File": "Crying.exp3.json"}
      // ... 添加所有表情
    ],
    "Motions": {
      "Custom": [
        {"File": "123.motion3.json"},
        {"File": "meme.motion3.json"}
        // ... 添加所有动作
      ]
    }
  },
  "Groups": [...]
}
```

#### 选项B：使用辅助脚本自动生成
创建一个Node.js脚本来自动补丁 model3.json：
```javascript
const fs = require('fs');
const path = require('path');

const modelDir = 'frontend/public/Resources/Commercial_models/英伦兔兔';
const modelJsonPath = path.join(modelDir, '英伦兔兔.model3.json');

// 读取现有配置
const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));

// 扫描表情文件
const expressions = fs.readdirSync(modelDir)
  .filter(f => f.endsWith('.exp3.json'))
  .map(f => ({
    Name: f.replace('.exp3.json', ''),
    File: f
  }));

// 扫描动作文件
const motions = fs.readdirSync(modelDir)
  .filter(f => f.endsWith('.motion3.json'))
  .map(f => ({ File: f }));

// 更新配置
modelJson.FileReferences.Expressions = expressions;
modelJson.FileReferences.Motions = { "Custom": motions };

// 保存
fs.writeFileSync(modelJsonPath, JSON.stringify(modelJson, null, '\t'));
console.log('✅ model3.json updated successfully!');
```

## 总结

| 方面 | 公开模型 | 商业模型（VTuber Studio） |
|------|---------|--------------------------|
| 文件组织 | 子文件夹 | 根目录 |
| model3.json | 完整声明 | 缺少声明 |
| 参数命名 | 描述性 | 通用ID |
| 直接兼容 | ✅ 是 | ❌ 否（需要补丁） |

**推荐行动：**
1. 短期：使用选项B的脚本为所有VTuber Studio模型生成补丁
2. 中期：实现方案三的动态补丁机制
3. 长期：考虑使用支持VTuber Studio的专用加载器

## 代码改动总结

### 文件：`frontend/server/live2dState.ts`
- 添加 VTuber Studio 模型检测逻辑
- 实现根目录文件自动扫描
- 记录模型元数据

### 文件：`frontend/src/components/Live2DComponent.tsx`
- 增强动作播放错误处理
- 增强表情播放错误处理  
- 修复 Commercial_models 资源路径

### 测试建议
1. 首先使用选项A或B修改 model3.json
2. 重启开发服务器
3. 切换到商业模型
4. 测试表情和动作播放
5. 检查浏览器控制台的日志输出

