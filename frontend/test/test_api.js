
/**
 * 测试脚本：对 Live2D API 进行快速回归测试
 *
 * 用法
 *   node test_api.js              # 依次测试动作/表情/音频
 *   node test_api.js list         # 列出所有资源
 *   node test_api.js motion       # 仅测试动作
 *   node test_api.js expression   # 仅测试表情
 *   node test_api.js sound        # 仅测试音频
 */

import { requestJson, resolveApiConfig } from '../test_utils/api-client.js';

const { args: cliArgs, apiBase: API_BASE } = resolveApiConfig(process.argv.slice(2));
const DEFAULT_MODEL = 'Haru';

async function getActions() {
    console.log('请求: GET /api/live2d/actions');
    try {
        const response = await requestJson(API_BASE, '/api/live2d/actions');
        if (!response.success) {
            throw new Error('获取动作列表失败');
        }
        console.log('已获取资源列表\n');
        return response.data;
    } catch (error) {
        console.error('失败:', error.message);
        console.error('提示: 请确认前端已启动 (pnpm dev)\n');
        return null;
    }
}

async function testPlayMotion(motionName, sound) {
    console.log(`请求: POST /api/live2d/play (动作: ${motionName})`);
    try {
        const response = await requestJson(API_BASE, '/api/live2d/play', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: motionName, sound }),
        });
        if (response.success) {
            console.log('动作触发成功\n');
            return true;
        }
        console.log('动作触发失败\n');
        return false;
    } catch (error) {
        console.error('请求异常:', error.message, '\n');
        return false;
    }
}

async function testPlayExpression(expressionName) {
    console.log(`请求: POST /api/live2d/expression (表情: ${expressionName})`);
    try {
        const response = await requestJson(API_BASE, '/api/live2d/expression', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expression: expressionName }),
        });
        if (response.success) {
            console.log('表情触发成功\n');
            return true;
        }
        console.log('表情触发失败\n');
        return false;
    } catch (error) {
        console.error('请求异常:', error.message, '\n');
        return false;
    }
}

async function testPlaySound(soundPath) {
    console.log(`请求: POST /api/live2d/sound (音频: ${soundPath})`);
    try {
        const response = await requestJson(API_BASE, '/api/live2d/sound', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sound: soundPath }),
        });
        if (response.success) {
            console.log('音频触发成功\n');
            return true;
        }
        console.log('音频触发失败\n');
        return false;
    } catch (error) {
        console.error('请求异常:', error.message, '\n');
        return false;
    }
}

function listResources(data) {
    console.log('-'.repeat(80));
    console.log('资源列表\n');

    console.log(`模型数量: ${data.models.length}`);
    console.log(`模型: ${data.models.join(', ')}\n`);

    for (const [modelName, actions] of Object.entries(data.actions)) {
        console.log(`模型: ${modelName}`);
        console.log(`   动作: ${actions.motions?.length || 0}`);
        console.log(`   表情: ${actions.expressions?.length || 0}`);
        console.log(`   音频: ${actions.sounds?.length || 0}`);
        console.log();
    }
    console.log('-'.repeat(80));
}

async function main() {
    const testType = cliArgs[0] || 'all';

    console.log('== Live2D API 测试套件 ==\n');
    console.log(`API_BASE: ${API_BASE}\n`);

    const data = await getActions();
    if (!data) {
        console.error('无法继续测试，请检查服务状态');
        process.exit(1);
    }

    if (testType === 'list') {
        listResources(data);
        return;
    }

    const modelName = data.models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : data.models[0];
    if (!modelName) {
        console.error('没有可用模型');
        process.exit(1);
    }

    const modelActions = data.actions[modelName];
    console.log(`使用模型: ${modelName}\n`);
    console.log('-'.repeat(80));
    console.log();

    let passCount = 0;
    let totalCount = 0;

    if (testType === 'all' || testType === 'motion') {
        if (modelActions.motions?.length) {
            totalCount += 1;
            const motion = modelActions.motions[0];
            if (await testPlayMotion(motion.group, motion.sound)) passCount += 1;
        } else {
            console.log('当前模型没有可用动作\n');
        }
    }

    if (testType === 'all' || testType === 'expression') {
        if (modelActions.expressions?.length) {
            totalCount += 1;
            const expression = modelActions.expressions[0];
            if (await testPlayExpression(expression.name)) passCount += 1;
        } else {
            console.log('当前模型没有可用表情\n');
        }
    }

    if (testType === 'all' || testType === 'sound') {
        if (modelActions.sounds?.length) {
            totalCount += 1;
            const sound = modelActions.sounds[0];
            if (await testPlaySound(sound)) passCount += 1;
        } else {
            console.log('当前模型没有可用音频\n');
        }
    }

    if (totalCount > 0) {
        console.log('-'.repeat(80));
        console.log(`\n测试结果: ${passCount}/${totalCount}`);
        if (passCount === totalCount) {
            console.log('所有测试通过\n');
        } else {
            console.log(`有 ${totalCount - passCount} 项失败\n`);
        }
        console.log('提示: 打开浏览器查看实时效果\n');
    }
}

main().catch((error) => {
    console.error('脚本运行异常:', error);
    process.exit(1);
});
