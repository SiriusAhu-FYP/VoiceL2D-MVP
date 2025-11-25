
/**
 * 测试脚本：获取音频列表并播放指定的音频
 *
 * 用法
 *   node test_sound.js [音频索引] [模型名称]
 */

import { requestJson, resolveApiConfig } from '../test_utils/api-client.js';

const { args: cliArgs, apiBase: API_BASE } = resolveApiConfig(process.argv.slice(2));
const DEFAULT_MODEL = 'Haru';

async function getActions() {
    try {
        const response = await requestJson(API_BASE, '/api/live2d/actions');
        if (!response.success) {
            throw new Error('获取动作列表失败');
        }
        return response.data;
    } catch (error) {
        console.error('请求失败:', error.message);
        console.error('提示: 请确认前端已启动 (pnpm dev)');
        process.exit(1);
    }
}

async function playSound(soundPath) {
    try {
        const response = await requestJson(API_BASE, '/api/live2d/sound', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sound: soundPath }),
        });
        return response.success;
    } catch (error) {
        console.error('播放音频失败:', error.message);
        return false;
    }
}

async function main() {
    const soundArg = cliArgs[0];
    const soundIndex = soundArg !== undefined ? Number.parseInt(soundArg, 10) : null;
    const modelName = cliArgs[1] || DEFAULT_MODEL;

    console.log('== Live2D 音频测试套件 ==\n');
    console.log('连接服务中...');
    console.log(`API_BASE: ${API_BASE}\n`);

    const data = await getActions();

    if (!data.models || data.models.length === 0) {
        console.error('没有可用的模型');
        process.exit(1);
    }

    if (!data.actions[modelName]) {
        console.error(`模型 "${modelName}" 不存在`);
        console.log(`可用模型: ${data.models.join(', ')}`);
        process.exit(1);
    }

    const sounds = data.actions[modelName].sounds || [];

    if (sounds.length === 0) {
        console.log(`模型 "${modelName}" 没有音频资源`);
        process.exit(0);
    }

    console.log(`模型: ${modelName}`);
    console.log(`音频数量: ${sounds.length}\n`);
    console.log('-'.repeat(80));
    console.log('音频列表:\n');

    sounds.forEach((sound, index) => {
        const fileName = sound.split('/').pop() || sound;
        console.log(`[${index}] ${fileName}`);
        console.log(`    路径: ${sound}`);
        console.log();
    });

    console.log('-'.repeat(80));

    if (soundIndex !== null) {
        if (Number.isNaN(soundIndex) || soundIndex < 0 || soundIndex >= sounds.length) {
            console.error(`\n音频索引 ${soundIndex} 超出范围 (0-${sounds.length - 1})`);
            process.exit(1);
        }

        const soundPath = sounds[soundIndex];
        const fileName = soundPath.split('/').pop() || soundPath;
        console.log(`\n播放音频 [${soundIndex}]: ${fileName}`);
        console.log(`   路径: ${soundPath}`);

        const success = await playSound(soundPath);
        if (success) {
            console.log('音频播放指令已发送');
            console.log('\n提示: 在浏览器中查看实际效果');
        } else {
            console.log('音频播放指令失败');
        }
    } else {
        console.log('\n提示: 使用 "node test_sound.js <索引> [模型]" 来播放指定音频');
        console.log(`示例: node test_sound.js 1 ${modelName}`);
    }
}

main().catch((error) => {
    console.error('脚本运行异常:', error);
    process.exit(1);
});
