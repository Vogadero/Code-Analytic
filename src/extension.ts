import * as vscode from "vscode";
import simpleGit, { SimpleGit, SimpleGitOptions } from "simple-git";

interface CodeStatistics {
    totalCommits: number;
    linesAdded: number;
    linesDeleted: number;
    filesAdded: number;
    filesModified: number;
    filesDeleted: number;
}

// 配置Git选项
const gitOptions: Partial<SimpleGitOptions> = {
    binary: "git",
    maxConcurrentProcesses: 6,
    trimmed: true,
};

// Git实例缓存
const gitInstances = new Map<string, SimpleGit>();

// 获取Git实例
function getGitInstance(cwd: string): SimpleGit {
    if (!gitInstances.has(cwd)) {
        gitInstances.set(cwd, simpleGit({ ...gitOptions, baseDir: cwd }));
    }
    return gitInstances.get(cwd)!;
}

// 增强型路径处理
function normalizePath(p: string): string {
    return vscode.Uri.file(p).fsPath.replace(/\\/g, "/");
}

// 获取所有工作区
async function getWorkspaces(): Promise<readonly vscode.WorkspaceFolder[]> {
    return vscode.workspace.workspaceFolders || [];
}

// 检测Git仓库
async function isGitRepository(folderPath: string): Promise<boolean> {
    try {
        const git = getGitInstance(folderPath);
        return await git.checkIsRepo();
    } catch (error) {
        console.error("Git仓库检测失败:", error);
        return false;
    }
}

// 获取分支列表（包含本地和远程）
async function getGitBranches(cwd: string): Promise<string[]> {
    try {
        const git = getGitInstance(cwd);
        const { branches } = await git.branch(["-a"]);

        return Object.values(branches)
            .filter((b) => !b.name.endsWith("/HEAD"))
            .map((b) => b.name.replace(/^remotes\/origin\//, ""))
            .filter((name, index, self) => self.indexOf(name) === index);
    } catch (error) {
        console.error("获取分支失败:", error);
        vscode.window.showErrorMessage("获取分支失败，请确认Git仓库状态");
        return [];
    }
}

// 获取分支作者列表
async function getBranchAuthors(cwd: string, branch?: string): Promise<string[]> {
    try {
        const git = getGitInstance(cwd);
        const options = branch ? { from: branch } : {};

        const logs = await git.log(options);
        return [...new Set(logs.all.map((commit) => commit.author_name.trim()).filter((name) => name.length > 0))];
    } catch (error) {
        console.error("获取作者失败:", error);
        return [];
    }
}

// 激活扩展
export async function activate(context: vscode.ExtensionContext) {
    console.log("扩展激活");

    // 注册配置视图
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("code-analytic.configView", {
            resolveWebviewView(webviewView) {
                webviewView.webview.options = {
                    enableScripts: true,
                    localResourceRoots: [context.extensionUri],
                };

                webviewView.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>代码分析</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/picnic">
    <script src="https://cdn.jsdelivr.net/npm/clipboard@2.0.8/dist/clipboard.min.js"></script>
    <style>
        /* 基础样式 */
        body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 1.5rem;
        }

        /* 卡片容器 */
        .analytic-card {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            overflow: hidden;
        }

        .analytic-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
        }

        /* 卡片头部 */
        .card-header {
            padding: 1rem;
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-input-border);
        }

        .card-title {
            margin: 0;
            font-size: 1.4rem;
            color: var(--vscode-titleBar-activeForeground);
            display: flex;
            align-items: center;
            gap: 0.8rem;
        }

        /* 表单区域 */
        .form-container {
            padding: 1.5rem;
            display: grid;
            gap: 1.2rem;
        }

        .form-group {
            display: grid;
            gap: 0.6rem;
        }

        /* 下拉选择 */
        select {
            width: 100%;
            border: 2px solid var(--vscode-input-border);
            border-radius: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            transition: all 0.2s ease;
            font-size: 0.95rem;
        }

        select:focus {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px var(--vscode-focusBorder);
            outline: none;
        }

        .button-group {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.8rem;
    margin-top: 1rem;
}

        /* 按钮样式 */
        .analyze-btn {
            padding: 0.8rem;
            justify-content: center;
            border-radius: 8px;
            font-weight: 500;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 0.6rem;
            margin-top: 1rem;
        }

        /* 结果面板 */
        #resultPanel {
            background: var(--vscode-editorWidget-background);
            border-radius: 8px;
            margin-top: 1.5rem;
            padding: 1.5rem;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s ease;
        }

        #resultPanel.show {
            opacity: 1;
            transform: translateY(0);
        }

        /* 加载状态 */
        .loading::after {
            border-width: 2px;
            width: 14px;
            height: 14px;
        }

        /* 图标美化 */
        .fa {
            font-size: 0.9em;
            color: var(--vscode-icon-foreground);
        }

        /* 刷新按钮特殊状态 */
#refreshBtn {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
}

#refreshBtn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
}

.loading-spinner {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    100% { transform: rotate(360deg); }
}

/* 图标颜色系统 */
.fa-chart-line{
color: #FF5722 !important; /* 折线图红色 */
}

.fa-folder-open, .workspace-icon {
    color: #4DABF7 !important; /* 工作区蓝色 */
}

.fa-code-branch, .branch-icon {
    color: #40C057 !important; /* 分支绿色 */
}

.fa-user-tag, .authors-icon, .fa-users {
    color: #BE4BDB !important; /* 作者紫色 */
}

.fa-play-circle {
    color: #FFC107 !important; /* 运行按钮黄色 */
}

.fa-sync-alt {
    color: #228BE6 !important; /* 刷新按钮蓝色 */
}

.fa-calendar-alt {
    color: #995670 !important;
}

.fa-chart-pie {
    color: #770100 !important;
}

.fa-hashtag {
    color: #ab2 !important;
}

/* 分隔符样式 */
.separator {
    color: var(--vscode-input-border);
    margin: 0 0.3rem;
    opacity: 0.6;
    font-weight: 300;
}

/* 结果面板图标放大 */
#resultPanel .fa {
    margin-right: 0.5rem;
}

/* 提交历史样式 */
.commit-history {
    border-top: 1px solid var(--vscode-input-border);
}

.commit-table {
    display: grid;
    grid-template-columns:  
        minmax(110px, 1fr)
        minmax(100px, 1fr)
        minmax(150px, 1.2fr)
        minmax(140px, 1.2fr)
        minmax(180px, 3fr)
        minmax(120px, 1fr);
    font-size: 0.9em;
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    overflow: hidden;
    background: var(--vscode-sideBar-background);
    min-width: 900px; /* 保证最小宽度 */
    overflow-x: auto;
    border-radius: 8px;
    scrollbar-width: thin;
    scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
}

.table-header {
    display: contents;
    font-weight: 600;
    background: var(--vscode-sideBarSectionHeader-background);
}

.table-header > span {
    padding: 12px;
    color: var(--vscode-editor-foreground);
    border-bottom: 2px solid var(--vscode-focusBorder);
    display: flex;
    align-items: center;
    background: var(--vscode-sideBarSectionHeader-background);
}

.commit-row {
    display: contents;
}

.commit-row > span {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-input-border);
    display: flex;
    align-items: center;
    color: var(--vscode-editor-foreground);
    transition: background 0.2s ease;
}

.commit-row:hover > span {
    background: var(--vscode-list-hoverBackground);
}

.commit-row:nth-child(even) > span {
    background-color: var(--vscode-editor-lineHighlightBackground);
}

/* 添加滚动支持 */
.commit-history {
    max-height: 60vh;
    overflow-y: auto;
}

/* 添加排序指示器 */
.table-header > span::after {
    content: "↓";
    margin-left: 8px;
    opacity: 0.5;
    font-size: 0.8em;
    transition: opacity 0.2s ease;
}

.table-header > span:hover::after {
    opacity: 1;
    color: var(--vscode-focusBorder);
}

/* 添加加载动画 */
@keyframes pulse {
    0% { opacity: 0.6; }
    50% { opacity: 1; }
    100% { opacity: 0.6; }
}

.loading-row > span {
    animation: pulse 1.5s infinite;
    background: var(--vscode-editor-lineHighlightBackground);
}

.hash {
    font-family: var(--vscode-editor-font-family);
    color: #40C057;
    cursor: pointer;
}

.hash:hover {
    text-decoration: underline;
}

.author {
    color: #BE4BDB;
}

.date {
    color: #868E96;
}

.message {
    white-space: normal;
    line-height: 1.4;
    max-height: 3.6em;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    transition: max-height 0.3s ease;
}

.message:hover {
    max-height: 20em;
    -webkit-line-clamp: unset;
}

/* 增加响应式设计 */
@media (max-width: 960px) {
    .commit-table {
        grid-template-columns: 
            minmax(80px, 1fr)
            minmax(80px, 1fr)
            minmax(100px, 1.2fr)
            minmax(100px, 1.2fr)
            minmax(150px, 3fr)
            minmax(80px, 1fr);
        font-size: 0.85em;
    }
    
    .message {
        -webkit-line-clamp: 1;
        font-size: 0.85em;
    }

    .table-header > span {
        padding: 8px 10px;
        font-size: 0.9em;
    }

    .commit-row > span {
        padding: 6px 10px;
    }

    .email {
        max-width: 120px;
    }
}

@media (max-width: 640px) {
    .commit-table {
        grid-template-columns: 
            minmax(70px, 1fr)
            minmax(90px, 1.2fr)
            minmax(90px, 1.2fr)
            minmax(130px, 3fr)
            minmax(70px, 1fr);
        font-size: 0.82em;
    }
    
    /* 隐藏邮箱和仓库列 */
    .commit-table > .email,
    .commit-table > .repo {
        display: none;
    }
    
    .table-header > span:nth-child(3),
    .table-header > span:nth-child(6) {
        display: none;
    }
}

/* 自定义滚动条 */
.commit-table::-webkit-scrollbar {
    height: 8px;
    background: var(--vscode-scrollbar-shadow);
}

.commit-table::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background);
    border-radius: 4px;
}

.commit-table::-webkit-scrollbar-thumb:hover {
    background: var(--vscode-scrollbarSlider-hoverBackground);
}

.repo {
    color: #4DABF7;
    cursor: help;
}

.no-commits {
    color: var(--vscode-disabledForeground);
    text-align: center;
    padding: 1rem;
}
.email {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: help;
}

/* 提交历史标题美化 */
.history-header {
    position: relative;
    margin: 1.5rem 0;
    background: linear-gradient(145deg, 
        var(--vscode-sideBarSectionHeader-background) 30%, 
        var(--vscode-input-background) 100%);
    border-radius: 12px;
    padding: 1.2rem;
    box-shadow: 0 4px 16px rgba(0,0,0,0.1);
    text-align: center;
}

.header-line {
    flex: 1;
    height: 1px;
    background: var(--vscode-input-border);
    margin: 0 1rem;
}

.header-title {
    position: relative;
    padding: 0 1.5rem;
    border-radius: 8px;
    transform: translateY(0);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.header-title:hover {
    transform: translateY(-2px);
    text-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.animated-line {
    position: relative;
    height: 2px;
    animation: line-expand 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.spinning-icon {
    animation: icon-spin 6s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite;
    color: #FF9F43;
    font-size: 1.4em;
    text-shadow: 0 2px 4px rgba(255,159,67,0.3);
}

.pulse {
    animation: pulse 1.5s ease-in-out infinite;
}

.commit-count {
    font-size: 0.85em;
    background: var(--vscode-badge-background);
    padding: 2px 8px;
    border-radius: 16px;
    margin-left: 8px;
    color: var(--vscode-badge-foreground);
}

/* 复制功能样式 */
.copyable {
    cursor: pointer;
    position: relative;
    transition: all 0.2s ease;
}

.copyable:hover {
    background: var(--vscode-list-hoverBackground) !important;
}

.copy-icon {
    margin-left: auto;
    opacity: 0.4;
    transition: opacity 0.2s ease;
}

.copyable:hover .copy-icon {
    opacity: 0.6;
}

.copyable:active .copy-icon {
    opacity: 1;
}

@keyframes fadeInOut {
    0% { opacity: 0; transform: translateY(10px); }
    20% { opacity: 1; transform: translateY(0); }
    80% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-10px); }
}

.copy-notification {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-editorWidget-foreground);
    padding: 8px 16px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    animation: fadeInOut 2s forwards;
    z-index: 1000;
}

@keyframes line-expand {
    0% { width: 0% }
    100% { width: 100% }
}

@keyframes icon-spin {
    0% { transform: rotateY(0deg) }
    100% { transform: rotateY(360deg) }
}

    /* 新增日期选择器样式 */
.date-range-picker {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 0.8rem;
    align-items: center;
}

.date-input {
    width: 100%;
    padding: 0.6rem;
    border: 2px solid var(--vscode-input-border);
    border-radius: 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-family: var(--vscode-font-family);
    transition: all 0.2s ease;
}

.date-input::-webkit-calendar-picker-indicator {
    filter: invert(0.5);
}

.date-input:focus {
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 0 0 2px var(--vscode-focusBorder);
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1rem;
    margin-top: 1.5rem;
}

.stat-card {
    background: var(--vscode-editorWidget-background);
    border-radius: 8px;
    padding: 1.2rem;
    text-align: center;
    transition: transform 0.2s ease;
}

.stat-card:hover {
    transform: translateY(-3px);
}

.stat-value {
    font-size: 1.8rem;
    font-weight: 600;
    color: var(--vscode-editor-foreground);
    margin-bottom: 0.5rem;
}

.stat-label {
    font-size: 0.9em;
    color: var(--vscode-descriptionForeground);
    opacity: 0.8;
}

#startHash, #endHash {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.9em;
}

/* 结论样式 */
.conclusion {
    margin-top: 2rem;
    padding: 1.5rem;
    background: var(--vscode-editor-lineHighlightBackground);
    border-radius: 8px;
    border-left: 4px solid var(--vscode-focusBorder);
}

.conclusion h4 {
    margin: 0 0 1rem 0;
    color: var(--vscode-editor-foreground);
    display: flex;
    align-items: center;
    gap: 0.8rem;
}

.conclusion p {
    margin: 0.6rem 0;
    line-height: 1.6;
    color: var(--vscode-descriptionForeground);
}

.conclusion .fa-lightbulb {
    color: #FFC107 !important;
    font-size: 1.2em;
}
    </style>
</head>
<body>
    <article class="analytic-card">
        <header class="card-header">
            <h2 class="card-title">
                <i class="fa fa-chart-line"></i>
                代码分析
            </h2>
        </header>
        
        <div class="form-container">
            <div class="form-group">
                <label for="workspaceSelect">
                    <i class="fa fa-folder-open"></i> 工作区选择
                </label>
                <select id="workspaceSelect" class="loading">
                    <option value="">加载工作区...</option>
                </select>
            </div>

            <div class="form-group">
                <label for="branchSelect">
                    <i class="fa fa-code-branch"></i> 分支选择
                </label>
                <select id="branchSelect" disabled>
                    <option value="">请先选择工作区</option>
                </select>
            </div>

            <div class="form-group">
                <label for="authorSelect">
                    <i class="fa fa-users"></i> 作者过滤
                </label>
                <select id="authorSelect" disabled>
                    <option value="">请先选择分支</option>
                </select>
            </div>

            <div class="form-group">
    <label for="dateRange">
        <i class="fa fa-calendar-alt"></i> 时间范围
    </label>
    <div class="date-range-picker">
        <input type="datetime-local" id="startDate" class="date-input" placeholder="选择开始时间">
        <span class="separator">至</span>
        <input type="datetime-local" id="endDate" class="date-input" placeholder="选择结束时间">
    </div>
</div>

<div class="form-group">
    <label for="hashRange">
        <i class="fa fa-hashtag"></i> 哈希过滤
    </label>
    <div class="date-range-picker">
        <input type="text" id="startHash" class="date-input" 
               placeholder="起始哈希（可选）" spellcheck="false">
        <span class="separator">至</span>
        <input type="text" id="endHash" class="date-input" 
               placeholder="结束哈希（可选）" spellcheck="false">
    </div>
</div>

            <div class="button-group">
    <button id="analyzeBtn" class="analyze-btn success">
        <i class="fa fa-play-circle"></i>
        开始分析
    </button>
    <button id="smartAnalysisBtn" class="analyze-btn warning" title="智能代码统计">
        <i class="fa fa-chart-pie"></i>
        智能统计
    </button>
    <button id="refreshBtn" class="analyze-btn" title="强制刷新所有数据">
        <i class="fa fa-sync-alt"></i>
        刷新数据
    </button>
</div>
        </div>
    </article>

    <article id="resultPanel" class="analytic-card">
        <!-- 结果内容保持不变 -->
    </article>

    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">

    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            const workspaceSelect = document.getElementById('workspaceSelect');
            const branchSelect = document.getElementById('branchSelect');
            const authorSelect = document.getElementById('authorSelect');
            const analyzeBtn = document.getElementById('analyzeBtn');
            const resultPanel = document.getElementById('resultPanel');
            const refreshBtn = document.getElementById('refreshBtn');

            // 初始化消息监听
            window.addEventListener('message', event => {
                handleMessage(event.data);
            });

            // 初始化 clipboard.js
           const clipboard = new ClipboardJS('.copyable', {
               text: function(trigger) {
                   return trigger.getAttribute('data-clipboard-text') || '';
               }
           });

           clipboard.on('success', (e) => {
               showCopyNotification(\`已复制：\${e.text.substring(0,20)}\${e.text.length > 20 ? '...' : ''}\`);
               e.clearSelection();
           });

           clipboard.on('error', (e) => {
               showCopyNotification('复制失败，请手动选择内容后按Ctrl+C');
           });

           // 在脚本中添加输入验证
document.querySelectorAll('#startHash, #endHash').forEach(input => {
    input.addEventListener('input', (e) => {
        const value = e.target.value;
        if (value && !/^[a-fA-F0-9]{7,40}$/.test(value)) {
            input.style.borderColor = '#ff0000';
        } else {
            input.style.borderColor = 'var(--vscode-input-border)';
        }
    });
});

            // 消息处理器
            function handleMessage(data) {
                switch (data.type) {
                    case 'workspaces':
                        updateWorkspaceOptions(data.data);
                        break;
                    case 'branches':
                        updateBranchOptions(data.data);
                        break;
                    case 'authors':
                        updateAuthorOptions(data.data);
                        break;
                    case 'commitHistory':
                        renderCommitHistory(data.data);
                        break;
                    case 'smartAnalysis':
                        renderSmartAnalysis(data.data);
                        break;
                }
            }

            // 新增渲染函数
function renderCommitHistory(commits) {
    const historySection = document.createElement('div');
    historySection.className = 'commit-history';
    
    if (commits.length === 0) {
        historySection.innerHTML = '<p class="no-commits">📭 没有找到相关提交记录</p>';
    } else {
        historySection.innerHTML = \`
            <div class="history-header">
    <div class="header-line animated-line"></div>
    <h3 class="header-title">
        <i class="fa fa-history spinning-icon"></i>
        提交历史
        <span class="commit-count pulse">（最近\${commits.length}条）</span>
    </h3>
    <div class="header-line animated-line"></div>
</div>
            <div class="commit-table">
                <div class="table-header">
                    <span>哈希值</span>
                    <span>作者</span>
                    <span>邮箱</span>
                    <span>时间</span>
                    <span>提交信息</span>
                    <span>存储库</span>
                </div>
                \${commits.map(commit => \`
                    <div class="commit-row">
                        <span class="hash copyable" data-clipboard-text="\${commit.hash}" title="\${commit.hash}">
                            \${commit.hash.substring(0,7)}
                            <i class="fa fa-copy copy-icon"></i>
                        </span>
                        <span class="author copyable" data-clipboard-text="\${commit.author}" title="\${commit.author}">
                            \${commit.author}
                            <i class="fa fa-copy copy-icon"></i>
                        </span>
                        <span class="email copyable" data-clipboard-text="\${commit.email}" title="\${commit.email}">
                            \${commit.email.substring(0, 12)}...
                            <i class="fa fa-copy copy-icon"></i>
                        </span>
                        <span class="date copyable" data-clipboard-text="\${commit.date}" title="\${commit.date}">
                            \${commit.date}
                            <i class="fa fa-copy copy-icon"></i>
                        </span>
                        <span class="message copyable" data-clipboard-text="\${commit.message}" title="\${commit.message}">
                            \${commit.message}
                            <i class="fa fa-copy copy-icon"></i>
                        </span>
                        <span class="repo copyable" data-clipboard-text="\${commit.repository}" title="\${commit.repository}">
                            \${commit.repository.split('/').pop()}
                            <i class="fa fa-copy copy-icon"></i>
                        </span>
                    </div>
                \`).join('')}
            </div>
        \`;
    }
    
    resultPanel.appendChild(historySection);
}

function renderSmartAnalysis(stats) {
// 获取所有作者逻辑（与分析面板一致）
    const selectedAuthor = authorSelect.value;
    let authors = [];
    
    if (!selectedAuthor) {
        authors = Array.from(authorSelect.options)
                    .slice(1)
                    .map(opt => opt.textContent);
    } else {
        authors = [selectedAuthor];
    }
    resultPanel.innerHTML = \`
        <h3>📊 统计结果：</h3>
        <p><i class="fa fa-folder-open workspace-icon"></i> 工作区：\${workspaceSelect.options[workspaceSelect.selectedIndex].text}</p>
        <p><i class="fa fa-code-branch branch-icon"></i> 分支：\${branchSelect.value}</p>
        <p><i class="fa fa-users authors-icon"></i> 作者：\${
            authors.length > 0 
                ? authors.join(' <span class="separator">|</span> ') 
                : '全部作者'
        }</p>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">\${stats.totalCommits}</div>
                <div class="stat-label">总提交次数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">+\${stats.linesAdded}</div>
                <div class="stat-label">新增代码行</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">-\${stats.linesDeleted}</div>
                <div class="stat-label">删除代码行</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">+\${stats.filesAdded}</div>
                <div class="stat-label">新增文件数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">\${stats.filesModified}</div>
                <div class="stat-label">修改文件数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">-\${stats.filesDeleted}</div>
                <div class="stat-label">删除文件数</div>
            </div>
        </div>

        <!-- 新增结论部分 -->
        <div class="conclusion">
            <h4><i class="fa fa-lightbulb"></i> 分析结论</h4>
            <p>在选定范围内共产生\${stats.totalCommits}次提交，涉及\${stats.filesAdded + stats.filesModified}个文件变更。</p>
            <p>代码净增减：+\${stats.linesAdded - stats.linesDeleted}行（新增\${stats.linesAdded}行/删除\${stats.linesDeleted}行）</p>
            <p>文件变更类型分布：新增(\${stats.filesAdded}) / 修改(\${stats.filesModified}) / 删除(\${stats.filesDeleted})</p>
        </div>
    \`;
}


// 显示复制提示
function showCopyNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = message;
    
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.remove();
    }, 2000);
}

            // 更新工作区选项
            function updateWorkspaceOptions(workspaces) {
                workspaceSelect.classList.remove('loading');
                workspaceSelect.disabled = false;
                workspaceSelect.innerHTML = workspaces.length 
                    ? '<option value="">请选择工作区</option>'
                    : '<option value="">未找到有效工作区</option>';

                workspaces.forEach(ws => {
                    const option = document.createElement('option');
                    option.value = ws.path;
                    option.textContent = \`\${ws.name} (\${ws.path})\`;
                    workspaceSelect.appendChild(option);
                });
            }

            // 更新分支选项
            function updateBranchOptions(branches) {
                branchSelect.classList.remove('loading');
                branchSelect.disabled = false;
                branchSelect.innerHTML = branches.length 
                    ? '<option value="">请选择分支</option>'
                    : '<option value="">未找到有效分支</option>';

                branches.forEach(branch => {
                    const option = document.createElement('option');
                    option.value = branch;
                    option.textContent = branch;
                    branchSelect.appendChild(option);
                });
            }

            // 更新作者选项
            function updateAuthorOptions(authors) {
                authorSelect.classList.remove('loading');
                authorSelect.disabled = false;
                authorSelect.innerHTML = authors.length 
                    ? '<option value="">全部作者</option>'
                    : '<option value="">未找到提交作者</option>';

                authors.forEach(author => {
                    const option = document.createElement('option');
                    option.value = author;
                    option.textContent = author;
                    authorSelect.appendChild(option);
                });
            }

            // 事件绑定
            workspaceSelect.addEventListener('change', () => {
                if (!workspaceSelect.value) return;
                
                branchSelect.disabled = true;
                branchSelect.innerHTML = '<option value="">加载分支中...</option>';
                branchSelect.classList.add('loading');
                
                authorSelect.disabled = true;
                authorSelect.innerHTML = '<option value="">请先选择分支</option>';

                vscode.postMessage({
                    command: 'workspaceSelected',
                    path: workspaceSelect.value
                });
            });

            branchSelect.addEventListener('change', () => {
                if (!branchSelect.value) return;
                
                authorSelect.disabled = true;
                authorSelect.innerHTML = '<option value="">加载作者中...</option>';
                authorSelect.classList.add('loading');

                vscode.postMessage({
                    command: 'branchSelected',
                    path: workspaceSelect.value,
                    branch: branchSelect.value
                });
            });

            authorSelect.addEventListener('change', () => {
                analyzeBtn.disabled = !authorSelect.value;
            });

            refreshBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'refreshData' });
    
    // 清空时间范围选择
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';
    
    // 重置结果面板
    resultPanel.innerHTML = '';
    resultPanel.classList.remove('show');
    resultPanel.style.display = 'none';

    // 新增清空哈希输入
    document.getElementById('startHash').value = '';
    document.getElementById('endHash').value = '';

    // 重置选择器状态
    [workspaceSelect, branchSelect, authorSelect].forEach(select => {
        select.innerHTML = '<option value="">刷新中...</option>';
        select.disabled = true;
        select.classList.add('loading');
    });
    
    // 可选：显示加载提示
    vscode.window.showInformationMessage('正在刷新所有数据...');
});

            analyzeBtn.addEventListener('click', () => {
            const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const startHash = document.getElementById('startHash').value;
    const endHash = document.getElementById('endHash').value;
    // 新增有效性检查
    if (startDate && isNaN(new Date(startDate).getTime())) {
        vscode.postMessage({
    command: 'showError',
    text: "开始时间格式无效"
});
        return;
    }
    if (endDate && isNaN(new Date(endDate).getTime())) {
        vscode.postMessage({
    command: 'showError',
    text: "结束时间格式无效"
});
        return;
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    vscode.postMessage({
    command: 'showError',
    text: "结束时间不能早于开始时间"
});
    return;
}
    const selectedAuthor = authorSelect.value;
    let authors = [];
    
    if (!selectedAuthor) {
        // 获取所有作者选项（排除第一个"全部作者"选项）
        authors = Array.from(authorSelect.options)
                    .slice(1)
                    .map(opt => opt.textContent);
    } else {
        authors = [selectedAuthor];
    }

    resultPanel.classList.add('show');
    resultPanel.style.display = 'block';
    resultPanel.innerHTML = \`
        <h3>🎯 分析结果：</h3>
        <p><i class="fa fa-folder-open workspace-icon"></i> 工作区：\${workspaceSelect.options[workspaceSelect.selectedIndex].text}</p>
        <p><i class="fa fa-code-branch branch-icon"></i> 分支：\${branchSelect.value}</p>
        <p><i class="fa fa-users authors-icon"></i> 作者：\${authors.join(' <span class="separator">|</span> ')}</p>
    \`;

    // 请求提交历史
    vscode.postMessage({
        command: 'requestCommitHistory',
        path: workspaceSelect.value,
        branch: branchSelect.value,
        author: selectedAuthor || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        startHash: startHash || undefined,
        endHash: endHash || undefined
    });
});

// 新增智能统计按钮处理
document.getElementById('smartAnalysisBtn').addEventListener('click', () => {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const startHash = document.getElementById('startHash').value;
    const endHash = document.getElementById('endHash').value;
    // 新增有效性检查
    if (startDate && isNaN(new Date(startDate).getTime())) {
        vscode.postMessage({
    command: 'showError',
    text: "开始时间格式无效"
});
        return;
    }
    if (endDate && isNaN(new Date(endDate).getTime())) {
        vscode.postMessage({
    command: 'showError',
    text: "结束时间格式无效"
});
        return;
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
        vscode.postMessage({
    command: 'showError',
    text: "结束时间不能早于开始时间"
});
        return;
    }

    vscode.postMessage({
        command: 'requestSmartAnalysis',
        path: workspaceSelect.value,
        branch: branchSelect.value,
        author: authorSelect.value || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        startHash: startHash || undefined,
        endHash: endHash || undefined
    });
});

            // 初始化请求工作区数据
            vscode.postMessage({ command: 'init' });
        })();
    </script>
</body>
</html>`;

                // 消息处理
                webviewView.webview.onDidReceiveMessage(async (message) => {
                    try {
                        switch (message.command) {
                            case "init":
                                const workspaces = await getWorkspaces();
                                webviewView.webview.postMessage({
                                    type: "workspaces",
                                    data: workspaces.map((ws) => ({
                                        name: ws.name,
                                        path: normalizePath(ws.uri.fsPath),
                                    })),
                                });
                                break;

                            case "workspaceSelected":
                                const workspacePath = normalizePath(message.path);
                                if (!(await isGitRepository(workspacePath))) {
                                    throw new Error("该目录不是Git仓库");
                                }

                                const branches = await getGitBranches(workspacePath);
                                webviewView.webview.postMessage({
                                    type: "branches",
                                    data: branches,
                                });
                                break;

                            case "branchSelected":
                                const authors = await getBranchAuthors(normalizePath(message.path), message.branch);
                                webviewView.webview.postMessage({
                                    type: "authors",
                                    data: authors,
                                });
                                break;
                            case "refreshData":
                                try {
                                    // 清空缓存
                                    gitInstances.clear();

                                    // 重新获取所有数据
                                    const refreshedWorkspaces = await getWorkspaces();
                                    webviewView.webview.postMessage({
                                        type: "workspaces",
                                        data: refreshedWorkspaces.map((ws) => ({
                                            name: ws.name,
                                            path: normalizePath(ws.uri.fsPath),
                                        })),
                                    });

                                    // 并行刷新所有仓库分支
                                    const refreshPromises = refreshedWorkspaces.map(async (ws) => {
                                        try {
                                            const path = normalizePath(ws.uri.fsPath);
                                            if (await isGitRepository(path)) {
                                                return getGitBranches(path);
                                            }
                                        } catch (error) {
                                            console.error(`仓库 ${ws.name} 刷新失败:`, error);
                                            return [];
                                        }
                                    });

                                    const results = await Promise.allSettled(refreshPromises);
                                    results.forEach((result, index) => {
                                        if (result.status === "rejected") {
                                            vscode.window.showErrorMessage(`${refreshedWorkspaces[index].name} 刷新失败: ${result.reason.message}`);
                                        }
                                    });
                                } catch (error) {
                                    vscode.window.showErrorMessage("刷新失败: " + error);
                                }
                                break;
                            case "requestCommitHistory":
                                const history = await getCommitHistory(normalizePath(message.path), message.branch, message.author, message.startDate, message.endDate, message.startHash, message.endHash);
                                webviewView.webview.postMessage({
                                    type: "commitHistory",
                                    data: history,
                                });
                                break;
                            case "requestSmartAnalysis":
                                const stats = await getCodeStatistics(normalizePath(message.path), message.branch, message.author, message.startDate, message.endDate, message.startHash, message.endHash);
                                webviewView.webview.postMessage({
                                    type: "smartAnalysis",
                                    data: stats,
                                });
                                break;
                            case "showError":
                                vscode.window.showErrorMessage(message.text);
                                break;
                        }
                    } catch (error) {
                        const message = error instanceof Error ? error.message : "未知错误";
                        vscode.window.showErrorMessage(message);
                        console.error("Webview错误:", error);
                    }
                });
            },
        })
    );

    // 添加环境检查
    checkGitEnvironment();
}

// 检查Git环境
async function checkGitEnvironment() {
    try {
        const git = simpleGit();
        const version = await git.version();

        if (version.major < 2) {
            vscode.window.showWarningMessage(`检测到旧版Git (${version})，建议升级到2.x以上版本`);
        }
    } catch (error) {
        vscode.window.showErrorMessage("未找到Git环境，请确认：\n" + "1. Git已安装并添加到PATH环境变量\n" + "2. 重启VSCode使配置生效");
    }
}

// 停用扩展时清理资源
export function deactivate() {
    gitInstances.clear();
}

// 获取提交历史（修正版）
async function getCommitHistory(cwd: string, branch?: string, author?: string, startDate?: string, endDate?: string, startHash?: string, endHash?: string): Promise<any[]> {
    try {
        const git = getGitInstance(cwd);
        const args: string[] = [];

        // 修正哈希范围处理逻辑
        let hashRange = "";
        if (startHash && endHash) {
            hashRange = `${startHash}^..${endHash}`; // 使用^包含起始提交
        } else if (startHash) {
            hashRange = startHash;
        } else if (endHash) {
            // 当只有结束哈希时，使用until过滤器
            args.push(`--until=${endHash}`);
        }

        // 使用与getCodeStatistics相同的日期格式处理
        const formatDate = (dateString?: string) => (dateString ? new Date(dateString).toISOString() : undefined);

        // 构建参数（保持与智能统计相同的参数结构）
        if (author) args.push(`--author=${author}`);
        if (startDate) args.push(`--since=${formatDate(startDate)}`);
        if (endDate) args.push(`--until=${formatDate(endDate)}`);

        // 保持参数顺序一致性
        args.push(
            "--no-merges",
            "--date=iso-strict",
            "--format=%H||%an||%ad||%s||%d||%ae",
            ...(branch ? [branch] : []) // 分支参数放在最后
        );

        // 添加哈希范围参数（放在最后）
        if (hashRange) args.push(hashRange);

        console.log("调试参数:", args);

        // 使用raw命令确保参数解析一致性
        const output = await git.raw(["log", ...args]);
        console.log("实际获取到的提交数量:", output); // 调试日志

        return processLogOutput(output, cwd);
    } catch (error) {
        console.error("获取提交历史失败:", error);
        vscode.window.showErrorMessage("获取提交历史失败，请确认Git日志格式");
        return [];
    }
}

// 新增公共日志处理方法
function processLogOutput(output: string, cwd: string) {
    return output
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => {
            const [hash, author, date, message, refs, email] = line.split("||", 6);
            return {
                hash: hash || "N/A",
                author: author || "Unknown",
                date: date ? new Date(date).toLocaleString() : "N/A",
                message: message || "No message",
                branch: refs?.replace(/[()]/g, "").replace(/ -> /g, " → ") || "N/A",
                repository: normalizePath(cwd),
                email: email || "N/A",
            };
        });
}

// 智能统计
async function getCodeStatistics(cwd: string, branch?: string, author?: string, startDate?: string, endDate?: string, startHash?: string, endHash?: string): Promise<CodeStatistics> {
    try {
        const git = getGitInstance(cwd);
        const options = [branch || "", author ? `--author=${author}` : "", startDate ? `--since=${new Date(startDate).toISOString()}` : "", endDate ? `--until=${new Date(endDate).toISOString()}` : "", "--numstat", "--format=|||%n"].filter((x) => x !== "");

        const args = [
            branch, // 直接传递分支名称
            ...options.filter((opt) => opt !== branch),
        ];

        // 修正哈希范围处理逻辑
        let hashRange = "";
        if (startHash && endHash) {
            hashRange = `${startHash}^..${endHash}`;
        } else if (startHash) {
            hashRange = startHash;
        } else if (endHash) {
            args.push(`--until=${endHash}`);
        }

        // 添加哈希范围
        if (hashRange) args.push(hashRange);

        console.log("调试参数:", args);

        const output = await git.raw(["log", ...args.filter((arg): arg is string => Boolean(arg))]);
        console.log("111111111111", output, git.raw);

        const stats: CodeStatistics = {
            totalCommits: 0,
            linesAdded: 0,
            linesDeleted: 0,
            filesAdded: 0,
            filesModified: 0,
            filesDeleted: 0,
        };

        const commitBlocks = output.split("|||");
        stats.totalCommits = commitBlocks.length - 1;

        commitBlocks.forEach((block) => {
            const lines = block.split("\n");
            lines.forEach((line) => {
                const parts = line.trim().split("\t");
                if (parts.length === 3) {
                    const [add, del, file] = parts;
                    if (file) {
                        stats.linesAdded += parseInt(add) || 0;
                        stats.linesDeleted += parseInt(del) || 0;

                        if (file.startsWith("dev/null")) {
                            stats.filesDeleted++;
                        } else if (/^0+$/.test(add)) {
                            stats.filesModified++;
                        } else {
                            stats.filesAdded++;
                        }
                    }
                }
            });
        });

        return stats;
    } catch (error) {
        console.error("统计失败:", error);
        vscode.window.showErrorMessage("代码统计失败");
        return {
            totalCommits: 0,
            linesAdded: 0,
            linesDeleted: 0,
            filesAdded: 0,
            filesModified: 0,
            filesDeleted: 0,
        };
    }
}

export { getGitInstance, normalizePath, getWorkspaces, isGitRepository, getCommitHistory, CodeStatistics, getCodeStatistics };
