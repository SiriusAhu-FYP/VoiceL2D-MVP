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

export class Live2DStateManager {
  private dataset: ResourcesData = { models: [], actions: {} };
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

    const models = readdirSync(resourcesPath).filter((item) => {
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

        const soundsPath = join(modelPath, 'sounds');
        if (existsSync(soundsPath)) {
          const soundFiles = readdirSync(soundsPath).filter((file) =>
            file.endsWith('.wav') || file.endsWith('.mp3') || file.endsWith('.ogg'),
          );
          sounds.push(...soundFiles.map((file) => `sounds/${file}`));
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
}

export const live2dStateManager = new Live2DStateManager();
