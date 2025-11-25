/**
 * Live2D 模型加载测试脚本
 * 使用 Playwright 自动打开浏览器并检查页面加载和错误
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

const SERVER_URL = 'http://localhost:7788';
const TIMEOUT = 30000; // 30秒超时

// 启动开发服务器
function startDevServer() {
    return new Promise((resolve, reject) => {
        console.log('启动开发服务器...');
        const server = spawn('pnpm', ['dev'], {
            shell: true,
            stdio: 'pipe',
        });

        let serverReady = false;

        server.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(output);
            // 检查服务器是否已启动
            if (output.includes('Local:') || output.includes('localhost')) {
                if (!serverReady) {
                    serverReady = true;
                    console.log('开发服务器已启动');
                    resolve(server);
                }
            }
        });

        server.stderr.on('data', (data) => {
            console.error(`服务器错误: ${data}`);
        });

        server.on('error', (error) => {
            console.error(`无法启动服务器: ${error.message}`);
            reject(error);
        });

        // 超时处理
        setTimeout(10000).then(() => {
            if (!serverReady) {
                console.log('服务器可能已启动，继续测试...');
                resolve(server);
            }
        });
    });
}

// 等待服务器可访问
async function waitForServer(context, url, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await context.request.get(url);
            if (response.ok()) {
                return true;
            }
        } catch (error) {
            // 服务器尚未启动，继续等待
        }
        await setTimeout(1000);
    }
    return false;
}

// 测试 Live2D 模型加载
async function testLive2D() {
    let browser;
    let server;
    let context;

    try {
        // 1. 启动开发服务器
        server = await startDevServer();
        
        // 2. 启动浏览器
        console.log('启动浏览器...');
        browser = await chromium.launch({
            headless: false, // 显示浏览器窗口以便查看
        });

        context = await browser.newContext();
        
        // 3. 等待服务器可访问
        console.log('等待服务器可访问...');
        const serverReady = await waitForServer(context, SERVER_URL);
        if (!serverReady) {
            throw new Error('服务器无法访问');
        }

        const page = await context.newPage();

        // 收集控制台消息和错误
        const consoleMessages = [];
        const errors = [];
        const networkErrors = [];

        page.on('console', (msg) => {
            const text = msg.text();
            consoleMessages.push({
                type: msg.type(),
                text: text,
            });
            console.log(`[控制台 ${msg.type()}]: ${text}`);
        });

        page.on('pageerror', (error) => {
            errors.push(error.message);
            console.error(`[页面错误]: ${error.message}`);
        });

        page.on('response', (response) => {
            if (!response.ok()) {
                networkErrors.push({
                    url: response.url(),
                    status: response.status(),
                    statusText: response.statusText(),
                });
                console.error(`[网络错误] ${response.status()} ${response.statusText()}: ${response.url()}`);
            }
        });

        // 4. 访问页面
        console.log(`访问 ${SERVER_URL}...`);
        await page.goto(SERVER_URL, {
            waitUntil: 'networkidle',
            timeout: TIMEOUT,
        });

        // 5. 等待 Live2D Core SDK 加载
        console.log('等待 Live2D Core SDK 加载...');
        await page.waitForFunction(
            () => window.Live2DCubismCore !== undefined,
            { timeout: 10000 }
        ).catch(() => {
            console.warn('Live2D Core SDK 可能未正确加载');
        });

        // 6. 等待模型加载（检查控制台消息）
        console.log('等待 Live2D 模型加载...');
        await setTimeout(5000); // 等待5秒让模型加载

        // 7. 检查是否有 canvas 元素
        const canvasExists = await page.evaluate(() => {
            const canvas = document.querySelector('canvas');
            return canvas !== null && canvas.width > 0 && canvas.height > 0;
        });

        if (!canvasExists) {
            console.error('Canvas 元素不存在或未正确初始化');
        } else {
            console.log('✓ Canvas 元素已创建');
        }

        // 8. 检查控制台是否有成功消息
        const hasSuccessMessage = consoleMessages.some(
            (msg) => msg.text.includes('Live2D 模型加载成功') || msg.text.includes('Live2D 模型加载成功') || msg.text.includes('Cubism 4 框架已启动')
        );

        if (hasSuccessMessage) {
            console.log('✓ Live2D 模型加载成功');
        } else {
            console.warn('⚠ 未找到模型加载成功的消息');
        }

        // 9. 检查是否有错误
        const hasErrors = errors.length > 0 || networkErrors.length > 0;

        if (hasErrors) {
            console.error('\n=== 发现错误 ===');
            if (errors.length > 0) {
                console.error('页面错误:');
                errors.forEach((error) => console.error(`  - ${error}`));
            }
            if (networkErrors.length > 0) {
                console.error('网络错误:');
                networkErrors.forEach((error) => console.error(`  - ${error.status} ${error.statusText}: ${error.url}`));
            }
        }

        // 10. 截图保存
        const screenshotPath = 'test-screenshot.png';
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`✓ 截图已保存: ${screenshotPath}`);

        // 11. 等待一段时间以便查看页面
        console.log('\n等待10秒以便查看页面...');
        await setTimeout(10000);

        // 12. 汇总结果
        console.log('\n=== 测试结果汇总 ===');
        console.log(`控制台消息数: ${consoleMessages.length}`);
        console.log(`页面错误数: ${errors.length}`);
        console.log(`网络错误数: ${networkErrors.length}`);
        console.log(`Canvas 存在: ${canvasExists ? '✓' : '✗'}`);
        console.log(`模型加载成功: ${hasSuccessMessage ? '✓' : '?'}`);

        if (!hasErrors && canvasExists) {
            console.log('\n✓ 测试通过！Live2D 模型应该已正确加载');
            return 0;
        } else {
            console.log('\n✗ 测试失败！请检查上述错误');
            return 1;
        }

    } catch (error) {
        console.error('\n测试过程中发生错误:', error);
        return 1;
    } finally {
        // 清理
        if (browser) {
            await browser.close();
        }
        if (server) {
            console.log('\n关闭开发服务器...');
            server.kill();
        }
    }
}

// 运行测试
testLive2D().then((exitCode) => {
    process.exit(exitCode);
}).catch((error) => {
    console.error('测试脚本执行失败:', error);
    process.exit(1);
});

