import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import type { ExpressionInfo, MotionInfo, ResourcesData } from '../src/api/live2d-api';

type ModelActions = ResourcesData['actions'][string];

const resourcesPath = join(process.cwd(), 'public/Resources');

const MOTION_KEY_FALLBACK = Symbol('motionKey');

const randomPick = <T>(items: T[]): T => {
  return items[Math.floor(Math.random() * items.length)];
};

const motionKey = (motion: MotionInfo): string | typeof MOTION_KEY_FALLBACK => {
  return motion.group ?? motion.name ?? motion.file ?? MOTION_KEY_FALLBACK;
};

const expressionKey = (expression: ExpressionInfo): string | undefined => {
  return expression.name ?? expression.file;
};

interface ModelMetadata {
  path: string;
  isVTuberStudio: boolean;
}

export class Live2DStateManager {
  private dataset: ResourcesData = { models: [], actions: {} };
  private modelMetadata: Map<string, ModelMetadata> = new Map();
  private currentModel: string | null = null;
  private lastModelUpdateAt: number | null = null;

  private lastMotionKey: string | typeof MOTION_KEY_FALLBACK | null = null;
  private lastExpressionName: string | null = null;
  private lastSoundName: string | null = null;
  private lastCombo: [string | typeof MOTION_KEY_FALLBACK | null, string | null, string | null] | null = null;

  refreshResources(): ResourcesData {
    this.dataset = this.scanResources();
    this.ensureCurrentModel();
    return this.dataset;
  }

  getModelMetadata(modelName: string): ModelMetadata | undefined {
    return this.modelMetadata.get(modelName);
  }

  getResourcesSnapshot(): ResourcesData {
    if (!this.dataset.models.length) {
      this.refreshResources();
    }
    return this.dataset;
  }

  getCurrentModelName(): string | null {
    if (!this.currentModel) {
      this.ensureCurrentModel();
    }
    return this.currentModel;
  }

  setCurrentModel(name: string): boolean {
    const dataset = this.getResourcesSnapshot();
    if (!dataset.models.includes(name)) {
      return false;
    }
    this.currentModel = name;
    this.lastModelUpdateAt = Date.now();
    return true;
  }

  getLastModelUpdateISO(): string | null {
    return this.lastModelUpdateAt ? new Date(this.lastModelUpdateAt).toISOString() : null;
  }

  getCurrentModelActions(): ModelActions | null {
    const dataset = this.getResourcesSnapshot();
    const modelName = this.getCurrentModelName();
    if (!modelName) {
      return null;
    }
    return dataset.actions[modelName] ?? null;
  }

  getMotionByIndex(index: number): MotionInfo | null {
    const actions = this.getCurrentModelActions();
    if (!actions || index < 0 || index >= actions.motions.length) {
      return null;
    }
    return actions.motions[index];
  }

  findMotionByGroup(group: string): MotionInfo | null {
    const actions = this.getCurrentModelActions();
    if (!actions) {
      return null;
    }
    return actions.motions.find((motion) => motion.group === group) ?? null;
  }

  findExpressionByName(name: string): ExpressionInfo | null {
    const actions = this.getCurrentModelActions();
    if (!actions) {
      return null;
    }
    return actions.expressions.find((expression) => expression.name === name) ?? null;
  }

  hasSound(sound: string): boolean {
    const actions = this.getCurrentModelActions();
    if (!actions) {
      return false;
    }
    return actions.sounds.includes(sound);
  }

  recordMotion(motion: MotionInfo | null, sound?: string): void {
    this.lastMotionKey = motion ? motionKey(motion) : null;
    if (sound) {
      this.lastSoundName = sound;
    }
  }

  recordExpression(expression: ExpressionInfo | string | null | undefined): void {
    if (!expression) {
      this.lastExpressionName = null;
      return;
    }
    this.lastExpressionName = typeof expression === 'string' ? expression : expression.name ?? null;
  }

  recordSound(sound: string | null | undefined): void {
    this.lastSoundName = sound ?? null;
  }

  pickRandomMotion(): { motion?: MotionInfo; error?: string } {
    const actions = this.getCurrentModelActions();
    if (!actions || actions.motions.length === 0) {
      return { error: 'The current model exposes no playable motions.' };
    }
    const candidates = actions.motions.filter((m) => motionKey(m) !== this.lastMotionKey);
    if (!candidates.length) {
      return { error: 'No alternative motion is available.' };
    }
    const motion = randomPick(candidates);
    this.recordMotion(motion);
    return { motion };
  }

  pickRandomExpression(): { expression?: ExpressionInfo; error?: string } {
    const actions = this.getCurrentModelActions();
    if (!actions || actions.expressions.length === 0) {
      return { error: 'The current model exposes no expressions.' };
    }
    const candidates = actions.expressions.filter((expr) => expressionKey(expr) !== this.lastExpressionName);
    if (!candidates.length) {
      return { error: 'No alternative expression is available.' };
    }
    const expression = randomPick(candidates);
    this.recordExpression(expression);
    return { expression };
  }

  pickRandomSound(): { sound?: string; error?: string } {
    const actions = this.getCurrentModelActions();
    if (!actions || actions.sounds.length === 0) {
      return { error: 'The current model exposes no standalone sounds.' };
    }
    const candidates = actions.sounds.filter((sound) => sound !== this.lastSoundName);
    if (!candidates.length) {
      return { error: 'No alternative sound is available.' };
    }
    const sound = randomPick(candidates);
    this.recordSound(sound);
    return { sound };
  }

  pickRandomCombo():
    | {
      motion: MotionInfo;
      expression: ExpressionInfo;
      sound: string;
    }
    | { error: string } {
    const actions = this.getCurrentModelActions();
    if (!actions) {
      return { error: 'Unable to load model resources.' };
    }
    if (!actions.motions.length || !actions.expressions.length || !actions.sounds.length) {
      return { error: 'The current model lacks motions, expressions, or sounds required for a combo.' };
    }

    const combos: Array<[MotionInfo, ExpressionInfo, string]> = [];
    actions.motions.forEach((motion) => {
      actions.expressions.forEach((expression) => {
        actions.sounds.forEach((sound) => {
          combos.push([motion, expression, sound]);
        });
      });
    });

    const alternatives = combos.filter((combo) => {
      const key: [string | typeof MOTION_KEY_FALLBACK | null, string | null, string | null] = [
        motionKey(combo[0]),
        combo[1].name ?? null,
        combo[2],
      ];
      return key.toString() !== (this.lastCombo ? this.lastCombo.toString() : '');
    });

    if (!alternatives.length) {
      return { error: 'No combination different from the previous state is available.' };
    }

    const [motion, expression, sound] = randomPick(alternatives);
    this.lastCombo = [motionKey(motion), expression.name ?? null, sound ?? null];
    this.recordMotion(motion, sound);
    this.recordExpression(expression);
    this.recordSound(sound);
    return { motion, expression, sound };
  }

  private ensureCurrentModel(): void {
    if (this.currentModel && this.dataset.models.includes(this.currentModel)) {
      return;
    }
    this.currentModel = this.dataset.models[0] ?? null;
  }

  private scanResources(): ResourcesData {
    const result: ResourcesData = {
      models: [],
      actions: {},
    };

    if (!existsSync(resourcesPath)) {
      return result;
    }

    // Scan regular models in Resources directory
    this.scanRegularModels(resourcesPath, result);

    // Scan Commercial_models subdirectory
    const commercialModelsPath = join(resourcesPath, 'Commercial_models');
    if (existsSync(commercialModelsPath) && statSync(commercialModelsPath).isDirectory()) {
      this.scanCommercialModels(commercialModelsPath, result);
    }

    return result;
  }

  private scanRegularModels(basePath: string, result: ResourcesData): void {
    const items = readdirSync(basePath).filter((item) => {
      const itemPath = join(basePath, item);
      // Skip Commercial_models directory and hidden directories
      if (item === 'Commercial_models' || item.startsWith('.')) {
        return false;
      }
      return statSync(itemPath).isDirectory();
    });

    for (const modelName of items) {
      const modelPath = join(basePath, modelName);
      const modelJsonPath = join(modelPath, `${modelName}.model3.json`);

      if (!existsSync(modelJsonPath)) {
        continue;
      }

      const actions = this.parseRegularModel(modelPath, modelName, modelJsonPath);
      if (actions) {
        result.models.push(modelName);
        result.actions[modelName] = actions;
        this.modelMetadata.set(modelName, {
          path: `/Resources/${modelName}`,
          isVTuberStudio: false,
        });
      }
    }
  }

  private scanCommercialModels(commercialPath: string, result: ResourcesData): void {
    const modelFolders = readdirSync(commercialPath).filter((item) => {
      const itemPath = join(commercialPath, item);
      return statSync(itemPath).isDirectory() && !item.startsWith('.');
    });

    for (const modelName of modelFolders) {
      const modelPath = join(commercialPath, modelName);
      const modelJsonPath = join(modelPath, `${modelName}.model3.json`);
      const vtubeJsonPath = join(modelPath, `${modelName}.vtube.json`);

      if (!existsSync(modelJsonPath)) {
        continue;
      }

      // Check if this is a VTuber Studio model
      const isVTuberStudio = existsSync(vtubeJsonPath);

      const actions = isVTuberStudio
        ? this.parseVTuberStudioModel(modelPath, modelName, modelJsonPath, vtubeJsonPath)
        : this.parseRegularModel(modelPath, modelName, modelJsonPath);

      if (actions) {
        result.models.push(modelName);
        result.actions[modelName] = actions;
        this.modelMetadata.set(modelName, {
          path: `/Resources/Commercial_models/${modelName}`,
          isVTuberStudio,
        });
      }
    }
  }

  private parseRegularModel(modelPath: string, _modelName: string, modelJsonPath: string): ModelActions | null {
    try {
      interface MotionFileReference {
        File?: string;
        Sound?: string;
      }
      interface ExpressionFileReference {
        Name?: string;
        File?: string;
      }
      interface ModelJson {
        FileReferences?: {
          Motions?: Record<string, MotionFileReference[]>;
          Expressions?: ExpressionFileReference[];
        };
      }

      const modelJson = JSON.parse(readFileSync(modelJsonPath, 'utf-8')) as ModelJson;
      const motions: MotionInfo[] = [];
      const expressions: ExpressionInfo[] = [];
      const sounds: string[] = [];

      // Scan sounds directory
      const soundsPath = join(modelPath, 'sounds');
      if (existsSync(soundsPath)) {
        const soundFiles = readdirSync(soundsPath).filter((file) =>
          file.endsWith('.wav') || file.endsWith('.mp3') || file.endsWith('.ogg'),
        );
        sounds.push(...soundFiles.map((file) => `sounds/${file}`));
      }

      // Parse motions from model3.json
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

      // Parse expressions from model3.json
      const expressionReferences = modelJson.FileReferences?.Expressions ?? [];
      expressionReferences.forEach((expr) => {
        if (expr?.Name && expr?.File) {
          expressions.push({
            name: expr.Name,
            file: expr.File,
          });
        }
      });

      return { motions, expressions, sounds };
    } catch (error) {
      console.error(`Error parsing regular model ${modelJsonPath}:`, error);
      return null;
    }
  }

  private parseVTuberStudioModel(
    modelPath: string,
    modelName: string,
    modelJsonPath: string,
    vtubeJsonPath: string,
  ): ModelActions | null {
    try {
      // First try to parse standard model3.json structure
      const regularActions = this.parseRegularModel(modelPath, modelName, modelJsonPath);

      const motions: MotionInfo[] = regularActions?.motions ?? [];
      const expressions: ExpressionInfo[] = regularActions?.expressions ?? [];
      const sounds: string[] = regularActions?.sounds ?? [];

      // Auto-scan for motion files in root directory (VTuber Studio style)
      const files = readdirSync(modelPath);

      files.forEach((file) => {
        const filePath = join(modelPath, file);
        if (statSync(filePath).isFile()) {
          // Scan for motion files
          if (file.endsWith('.motion3.json')) {
            const motionName = file.replace('.motion3.json', '');
            // Avoid duplicates from model3.json
            if (!motions.some(m => m.file === file)) {
              motions.push({
                group: 'VTuberStudio',
                name: motionName,
                file: file,
              });
            }
          }

          // Scan for expression files
          if (file.endsWith('.exp3.json')) {
            const expressionName = file.replace('.exp3.json', '');
            // Avoid duplicates from model3.json
            if (!expressions.some(e => e.file === file)) {
              expressions.push({
                name: expressionName,
                file: file,
              });
            }
          }
        }
      });

      // Parse vtube.json for additional metadata (optional, for future use)
      try {
        JSON.parse(readFileSync(vtubeJsonPath, 'utf-8'));
        // VTuber Studio metadata is available but not used for now
        // Can be extended to read IdleAnimation, physics settings, etc.
      } catch (vtubeError) {
        console.warn(`Warning: Could not parse ${vtubeJsonPath}:`, vtubeError);
      }

      return { motions, expressions, sounds };
    } catch (error) {
      console.error(`Error parsing VTuber Studio model ${modelJsonPath}:`, error);
      return null;
    }
  }
}

export const live2dStateManager = new Live2DStateManager();
