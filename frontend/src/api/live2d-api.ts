/**
 * Live2D API 客户端
 * 用于调用后端API和获取资源列表
 */

export interface MotionInfo {
    group: string;
    name: string;
    file: string;
    sound?: string;
}

export interface ExpressionInfo {
    name: string;
    file: string;
}

export interface ModelActions {
    motions: MotionInfo[];
    expressions: ExpressionInfo[];
    sounds: string[];
}

export interface ResourcesData {
    models: string[];
    actions: Record<string, ModelActions>;
    modelPaths?: Record<string, string>; // Optional: map of model name to full path
}

export interface RandomComboData {
    motion: MotionInfo;
    expression: ExpressionInfo;
    sound: string;
}

export interface CurrentModelState {
    currentModel: string | null;
    availableActions: ModelActions | null;
    models: string[];
    updatedAt: string | null;
}

const API_BASE = '/api/live2d';

// 获取所有动作列表
export async function getActions(): Promise<ResourcesData | null> {
    try {
        const response = await fetch(`${API_BASE}/actions`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result.success ? result.data : null;
    } catch (error) {
        console.error('Failed to fetch actions:', error);
        return null;
    }
}

// 播放动作
export async function playAction(action: string, sound?: string): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/play`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action, sound }),
        });
        const result = await response.json();
        return result.success === true;
    } catch (error) {
        console.error('Failed to play action:', error);
        return false;
    }
}

// 播放表情
export async function playExpression(expression: string): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/expression`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ expression }),
        });
        const result = await response.json();
        return result.success === true;
    } catch (error) {
        console.error('Failed to play expression:', error);
        return false;
    }
}

// 播放声音
export async function playSound(sound: string): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/sound`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sound }),
        });
        const result = await response.json();
        return result.success === true;
    } catch (error) {
        console.error('Failed to play sound:', error);
        return false;
    }
}

// 获取当前模型状态
export async function getCurrentModelState(): Promise<CurrentModelState | null> {
    try {
        const response = await fetch(`${API_BASE}/state`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result.success ? result.data : null;
    } catch (error) {
        console.error('Failed to fetch current model state:', error);
        return null;
    }
}

// 更新当前模型状态
export async function updateCurrentModelState(modelName: string): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/state`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ currentModel: modelName }),
        });
        const result = await response.json();
        return result.success === true;
    } catch (error) {
        console.error('Failed to update current model state:', error);
        return false;
    }
}

// 获取模型路径
export async function getModelPath(modelName: string): Promise<string | null> {
    try {
        const response = await fetch(`${API_BASE}/model-path/${encodeURIComponent(modelName)}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result.success ? result.data?.path : null;
    } catch (error) {
        console.error('Failed to fetch model path:', error);
        return null;
    }
}
export async function switchModel(modelName: string): Promise<{ success: boolean; modelPath?: string; error?: string }> {
    try {
        const response = await fetch(`${API_BASE}/switch-model`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ modelName }),
        });
        const result = await response.json();
        if (result.success) {
            return {
                success: true,
                modelPath: result.data?.modelPath,
            };
        } else {
            return {
                success: false,
                error: result.error || 'Unknown error',
            };
        }
    } catch (error) {
        console.error('Failed to switch model:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Network error',
        };
    }
}

export async function playMotionByIndex(index: number): Promise<MotionInfo | null> {
    try {
        const response = await fetch(`${API_BASE}/motion/index`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ index }),
        });
        const result = await response.json();
        return result.success ? (result.data as MotionInfo) : null;
    } catch (error) {
        console.error('Failed to play motion by index:', error);
        return null;
    }
}

export async function requestRandomMotion(): Promise<MotionInfo | null> {
    try {
        const response = await fetch(`${API_BASE}/random/motion`, { method: 'POST' });
        const result = await response.json();
        return result.success ? (result.data as MotionInfo) : null;
    } catch (error) {
        console.error('Failed to request random motion:', error);
        return null;
    }
}

export async function requestRandomExpression(): Promise<ExpressionInfo | null> {
    try {
        const response = await fetch(`${API_BASE}/random/expression`, { method: 'POST' });
        const result = await response.json();
        return result.success ? (result.data as ExpressionInfo) : null;
    } catch (error) {
        console.error('Failed to request random expression:', error);
        return null;
    }
}

export async function requestRandomSound(): Promise<string | null> {
    try {
        const response = await fetch(`${API_BASE}/random/sound`, { method: 'POST' });
        const result = await response.json();
        return result.success ? (result.data?.sound as string) : null;
    } catch (error) {
        console.error('Failed to request random sound:', error);
        return null;
    }
}

export async function requestRandomCombo(): Promise<RandomComboData | null> {
    try {
        const response = await fetch(`${API_BASE}/random/combo`, { method: 'POST' });
        const result = await response.json();
        return result.success ? (result.data as RandomComboData) : null;
    } catch (error) {
        console.error('Failed to request random combo:', error);
        return null;
    }
}

export async function validateResource(type: 'motion' | 'expression' | 'sound', value: string): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/validate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ type, value }),
        });
        const result = await response.json();
        return result.success ? Boolean(result.data?.valid) : false;
    } catch (error) {
        console.error('Failed to validate resource:', error);
        return false;
    }
}

