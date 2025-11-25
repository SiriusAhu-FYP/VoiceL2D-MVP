
/**
 * 测试脚本：获取动作列表并执行指定的动作
 *
 * 用法
 *   node test_motion.js [动作索引] [模型名称]
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

async function playMotion(motionName, sound) {
    try {
        const response = await requestJson(API_BASE, '/api/live2d/play', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: motionName, sound }),
        });
        return response.success;
    } catch (error) {
        console.error('触发动作用失败:', error.message);
        return false;
    }
}

async function main() {
    const motionArg = cliArgs[0];
    const motionIndex = motionArg !== undefined ? Number.parseInt(motionArg, 10) : null;
    const modelName = cliArgs[1] || DEFAULT_MODEL;

    console.log('== Live2D 动作测试套件 ==\n');
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

    const motions = data.actions[modelName].motions || [];

    console.log(`模型: ${modelName}`);
    console.log(`动作数量: ${motions.length}\n`);
    console.log('-'.repeat(80));
    console.log('动作列表:\n');

    motions.forEach((motion, index) => {
        const soundInfo = motion.sound ? `有音效: ${motion.sound}` : '无音效';
        console.log(`[${index}] ${motion.name}`);
        console.log(`    分组: ${motion.group}`);
        console.log(`    文件: ${motion.file}`);
        console.log(`    音效: ${soundInfo}`);
        console.log();
    });

    console.log('-'.repeat(80));

    if (motionIndex !== null) {
        if (Number.isNaN(motionIndex) || motionIndex < 0 || motionIndex >= motions.length) {
            console.error(`\n动作索引 ${motionIndex} 超出范围 (0-${motions.length - 1})`);
            process.exit(1);
        }

        const motion = motions[motionIndex];
        console.log(`\n执行动作 [${motionIndex}]: ${motion.name}`);

        const success = await playMotion(motion.group, motion.sound);
        if (success) {
            console.log('动作触发成功');
            console.log('\n提示: 在浏览器中查看实际效果');
        } else {
            console.log('动作触发失败');
        }
    } else {
        console.log('\n提示: 使用 "node test_motion.js <索引> [模型]" 来执行指定动作');
        console.log(`示例: node test_motion.js 3 ${modelName}`);
    }
}

main().catch((error) => {
    console.error('脚本运行异常:', error);
    process.exit(1);
});
