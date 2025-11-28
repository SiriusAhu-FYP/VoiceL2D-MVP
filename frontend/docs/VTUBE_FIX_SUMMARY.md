### VTuber Studio 商业模型适配简化说明

#### 核心问题

**商业模型（COMMERCIAL_MODEL）表情与动作无法播放。**

#### 根本原因

1. **文件结构差异**

   * **官方模型（OFFICIAL_MODEL）**: 表情和动作分别位于 `expressions/` 和 `motions/` 文件夹。
   * **商业模型（COMMERCIAL_MODEL）**: 表情和动作直接位于根目录，缺少在 `model3.json` 中的声明。

2. **`model3.json` 差异**

   * **官方模型**: 完整的 `Expressions` 和 `Motions` 声明。
   * **商业模型**: 缺少 `Expressions` 和 `Motions` 的声明。

### 两种类型模型 `model3.json` 文件格式对比

#### **官方模型（OFFICIAL_MODEL）** `model3.json` 格式：

```json
{
  "FileReferences": {
    "Expressions": [
      {"Name": "angry", "File": "expressions/angry.exp3.json"},
      {"Name": "happy", "File": "expressions/happy.exp3.json"}
    ],
    "Motions": {
      "Idle": [
        {"File": "motions/idle.motion3.json"}
      ],
      "Jump": [
        {"File": "motions/jump.motion3.json"}
      ]
    }
  }
}
```

* **Expressions**: 列出了所有表情文件，并指定了文件路径。
* **Motions**: 列出了所有动作文件，并指定了文件路径，分为不同类型（如 `Idle` 和 `Jump`）。

#### **商业模型（COMMERCIAL_MODEL）** `model3.json` 格式：

```json
{
  "FileReferences": {
    "Moc": "COMMERCIAL_MODEL.moc3",
    "Textures": [...],
    "Physics": "COMMERCIAL_MODEL.physics3.json"
    // 缺少 Expressions 和 Motions 声明！
  }
}
```

* **缺失的部分**:

  * **Expressions**: 没有列出任何表情文件，导致表情无法加载。
  * **Motions**: 没有列出任何动作文件，导致动作无法播放。


#### 解决方案

1. **补丁 `model3.json` 文件**

   * 在 `COMMERCIAL_MODEL` 的 `model3.json` 中添加完整的 `Expressions` 和 `Motions` 声明，确保表情和动作可以正确加载。

2. **后端增强扫描**

   * 自动检测 `.vtube.json` 文件，扫描根目录的 `.exp3.json` 和 `.motion3.json` 文件，记录元数据。

3. **前端播放逻辑改进**

   * 增强错误处理和重试机制，确保 `COMMERCIAL_MODEL` 可以正确加载和播放表情与动作。

4. **自动化脚本**

   * 创建脚本批量处理更多商业模型，自动扫描并补全缺失的表情与动作声明。

#### 使用指导

* **现有商业模型**: 已手动完成适配，可以直接使用。
* **新增商业模型**: 运行补丁脚本自动适配：

  ```bash
  node frontend/scripts/patch-vtube-models.js
  ```

#### 技术细节

* **`model3.json` 补丁格式**:

  ```json
  {
    "FileReferences": {
      "Expressions": [
        {"Name": "happy", "File": "happy.exp3.json"}
      ],
      "Motions": {
        "Idle": [
          {"File": "idle.motion3.json"}
        ]
      }
    }
  }
  ```

* **后端扫描逻辑**:

  ```typescript
  // 检测和扫描表情文件
  files.forEach((file) => {
    if (file.endsWith('.exp3.json')) {
      expressions.push({
        name: file.replace('.exp3.json', ''),
        file: file
      });
    }
  });
  ```

#### 总结

通过补充 `model3.json` 文件的声明并改进后端扫描与前端播放逻辑，成功适配了 **COMMERCIAL_MODEL**，解决了表情与动作无法播放的问题。
