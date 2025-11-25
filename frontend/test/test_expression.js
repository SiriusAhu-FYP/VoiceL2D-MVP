
/**
 * 测试脚本：获取表情列表并执行指定的表情
 *
 * 用法
 *   node test_expression.js [表情索引] [模型名称]
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

async function playExpression(expressionName) {
    try {
        const response = await requestJson(API_BASE, '/api/live2d/expression', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ expression: expressionName }),
        });
        return response.success;
    } catch (error) {
        console.error('触发表情失败:', error.message);
        return false;
    }
}

async function main() {
    const expressionArg = cliArgs[0];
    const expressionIndex = expressionArg !== undefined ? Number.parseInt(expressionArg, 10) : null;
    const modelName = cliArgs[1] || DEFAULT_MODEL;

    console.log('== Live2D 表情测试套件 ==\n');
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

    const modelActions = data.actions[modelName];
    const expressions = modelActions.expressions || [];

    if (expressions.length === 0) {
        console.log(`模型 "${modelName}" 没有表情数据`);
        process.exit(0);
    }

    console.log(`模型: ${modelName}`);
    console.log(`表情数量: ${expressions.length}\n`);
    console.log('-'.repeat(80));
    console.log('表情列表:\n');

    expressions.forEach((expression, index) => {
        console.log(`[${index}] ${expression.name}`);
        console.log(`    文件: ${expression.file}`);
        console.log();
    });

    console.log('-'.repeat(80));

    if (expressionIndex !== null) {
        if (Number.isNaN(expressionIndex) || expressionIndex < 0 || expressionIndex >= expressions.length) {
            console.error(`\n表情索引 ${expressionIndex} 超出范围 (0-${expressions.length - 1})`);
            process.exit(1);
        }

        const expression = expressions[expressionIndex];
        console.log(`\n执行表情 [${expressionIndex}]: ${expression.name}`);

        const success = await playExpression(expression.name);
        if (success) {
            console.log('表情触发成功');
            console.log('\n提示: 在浏览器中查看实际效果');
        } else {
            console.log('表情触发失败');
        }
    } else {
        console.log('\n提示: 使用 "node test_expression.js <索引> [模型]" 来执行指定表情');
        console.log(`示例: node test_expression.js 2 ${modelName}`);
    }
}

main().catch((error) => {
    console.error('脚本运行异常:', error);
    process.exit(1);
});
