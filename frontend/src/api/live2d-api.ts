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

