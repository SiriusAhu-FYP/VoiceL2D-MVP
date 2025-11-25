# VoiceL2D-MVP Frontend

Live2D 模型展示和控制系统的前端项目，基于 React + TypeScript + Vite 开发。

## 功能特性

- 🎭 Live2D 模型展示和动画播放
- 🎨 动作、表情、声音的实时控制
- 🔌 HTTP API 接口支持外部调用
- 📱 响应式控制面板

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

服务器将运行在 `http://localhost:7788`

## API 测试

项目包含多个测试脚本，用于测试 Live2D API 功能。详细文档请查看 [TEST_SCRIPTS.md](./TEST_SCRIPTS.md)

### 快速测试

```bash
# 查看所有可用模型
node test_models.js

# 列出动作并执行第3个动作
node test_motion.js 3

# 列出表情并执行第2个表情
node test_expression.js 2

# 播放第0个声音
node test_sound.js 0

# 运行完整API测试
node test_api.js
```

### 可用测试脚本

- `test_motion.js` - 动作测试（列出并执行指定动作）
- `test_expression.js` - 表情测试（列出并执行指定表情）
- `test_sound.js` - 声音测试（列出并播放指定声音）
- `test_models.js` - 模型信息查看（查看所有模型详情）
- `test_api.js` - API集成测试（测试所有API端点）

## API 文档

详细的 API 文档请查看 [docs/API_DOCS.md](./docs/API_DOCS.md)

### API 端点

- `GET /api/live2d/actions` - 获取所有动作、表情、声音列表
- `POST /api/live2d/play` - 播放指定动作
- `POST /api/live2d/expression` - 播放指定表情
- `POST /api/live2d/sound` - 播放指定声音

## 项目结构

```
frontend/
├── public/
│   ├── Core/              # Live2D Core SDK
│   └── Resources/         # Live2D 模型资源
│       ├── Haru/
│       ├── Hiyori/
│       └── ...
├── src/
│   ├── api/              # API 客户端
│   ├── components/       # React 组件
│   └── ...
├── test_*.js            # API 测试脚本
├── TEST_SCRIPTS.md      # 测试脚本文档
└── vite.config.ts       # Vite 配置（包含 API 服务器）
```

## 开发说明

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is currently not compatible with SWC. See [this issue](https://github.com/vitejs/vite-plugin-react/issues/428) for tracking the progress.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
