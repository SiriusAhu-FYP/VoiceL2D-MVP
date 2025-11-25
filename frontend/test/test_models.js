
/**
 * 测试脚本：列出模型概览以及详细信息
 *
 * 用法
 *   node test_models.js            # 显示所有模型概览
 *   node test_models.js [模型名]   # 显示指定模型详情
 */

import { requestJson, resolveApiConfig } from '../test_utils/api-client.js';

const { args: cliArgs, apiBase: API_BASE } = resolveApiConfig(process.argv.slice(2));

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

function showOverview(data) {
    console.log('-'.repeat(80));
    console.log('Live2D 模型概览\n');
    console.log(`总计: ${data.models.length} 个模型\n`);

    data.models.forEach((modelName, index) => {
        const actions = data.actions[modelName];
        const motionCount = actions.motions?.length || 0;
        const expressionCount = actions.expressions?.length || 0;
        const soundCount = actions.sounds?.length || 0;

        console.log(`[${index}] ${modelName}`);
        console.log(`    动作: ${motionCount} | 表情: ${expressionCount} | 音频: ${soundCount}`);
        console.log();
    });

    console.log('-'.repeat(80));
    console.log('\n提示: 使用 "node test_models.js <模型名>" 查看详情');
    console.log('   示例: node test_models.js Haru\n');
}

function showModelDetails(data, modelName) {
    if (!data.actions[modelName]) {
        console.error(`模型 "${modelName}" 不存在`);
        console.log(`\n可用模型: ${data.models.join(', ')}`);
        process.exit(1);
    }

    const actions = data.actions[modelName];
    const motions = actions.motions || [];
    const expressions = actions.expressions || [];
    const sounds = actions.sounds || [];

    console.log('-'.repeat(80));
    console.log(`模型: ${modelName}\n`);

    console.log(`动作 (${motions.length}):`);
    if (motions.length > 0) {
        console.log();
        const groups = {};
        motions.forEach((motion) => {
            if (!groups[motion.group]) {
                groups[motion.group] = [];
            }
            groups[motion.group].push(motion);
        });

        for (const [group, groupMotions] of Object.entries(groups)) {
            console.log(`  分组: ${group} (${groupMotions.length} 个)`);
            groupMotions.forEach((motion, index) => {
                const soundInfo = motion.sound ? '有音效' : '无音效';
                console.log(`    [${index}] ${motion.name} ${soundInfo}`);
            });
            console.log();
        }
    } else {
        console.log('  无动作\n');
    }

    console.log(`表情 (${expressions.length}):`);
    if (expressions.length > 0) {
        console.log();
        expressions.forEach((expr, index) => {
            console.log(`  [${index}] ${expr.name}`);
        });
        console.log();
    } else {
        console.log('  无表情\n');
    }

    console.log(`音频 (${sounds.length}):`);
    if (sounds.length > 0) {
        console.log();
        sounds.forEach((sound, index) => {
            const fileName = sound.split('/').pop() || sound;
            console.log(`  [${index}] ${fileName}`);
        });
        console.log();
    } else {
        console.log('  无音频\n');
    }

    console.log('-'.repeat(80));
    console.log('\n推荐操作:');
    if (motions.length > 0) {
        console.log(`   node test_motion.js 0 ${modelName}      # 执行第 0 个动作`);
    }
    if (expressions.length > 0) {
        console.log(`   node test_expression.js 0 ${modelName}  # 执行第 0 个表情`);
    }
    if (sounds.length > 0) {
        console.log(`   node test_sound.js 0 ${modelName}       # 播放第 0 个音频`);
    }
    console.log();
}

async function main() {
    const modelName = cliArgs[0];

    console.log('== Live2D 模型信息工具 ==\n');
    console.log('连接服务中...');
    console.log(`API_BASE: ${API_BASE}\n`);

    const data = await getActions();

    if (!data.models || data.models.length === 0) {
        console.error('没有可用模型');
        process.exit(1);
    }

    if (modelName) {
        showModelDetails(data, modelName);
    } else {
        showOverview(data);
    }
}

main().catch((error) => {
    console.error('脚本运行异常:', error);
    process.exit(1);
});
