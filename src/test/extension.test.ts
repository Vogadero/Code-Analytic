import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as sinon from "sinon";
import { getGitInstance, normalizePath, getWorkspaces, isGitRepository, getCommitHistory, CodeStatistics, getCodeStatistics } from "../extension";

// 测试常量
const TEST_REPO_PATH = path.join(__dirname, "..", "..", "..", "test-repo");
const INVALID_PATH = "/invalid/path/to/repo";
const TEST_BRANCH = "main";
const TEST_AUTHOR = "test-author";

suite("Extension Test Suite", () => {
    let sandbox: sinon.SinonSandbox;

    suiteSetup(async () => {
        sandbox = sinon.createSandbox();
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });

    suiteTeardown(() => {
        sandbox.restore();
    });

    test("路径标准化处理", () => {
        const winPath = "C:\\Users\\test\\project";
        const normalized = normalizePath(winPath);
        assert.strictEqual(normalized, "C:/Users/test/project");
    });

    test("Git实例缓存机制", () => {
        const git1 = getGitInstance(TEST_REPO_PATH);
        const git2 = getGitInstance(TEST_REPO_PATH);
        assert.strictEqual(git1, git2, "应返回相同的Git实例");
    });

    test("工作区检测功能", async () => {
        // 模拟工作区
        sandbox.stub(vscode.workspace, "workspaceFolders").value([{ uri: vscode.Uri.file(TEST_REPO_PATH), name: "Test Repo", index: 0 }]);

        const workspaces = await getWorkspaces();
        assert.strictEqual(workspaces.length, 1);
        assert.strictEqual(workspaces[0].name, "Test Repo");
    });

    test("Git仓库验证", async () => {
        const valid = await isGitRepository(TEST_REPO_PATH);
        assert.strictEqual(valid, true);

        const invalid = await isGitRepository(INVALID_PATH);
        assert.strictEqual(invalid, false);
    });

    test("提交历史分析 - 正常流程", async () => {
        const commits = await getCommitHistory(TEST_REPO_PATH, TEST_BRANCH);

        assert.ok(commits.length > 0);
        assert.match(commits[0].hash, /^[a-f0-9]{7,40}$/);
        assert.doesNotThrow(() => new Date(commits[0].date));
    });

    test("智能统计功能 - 边界条件", async () => {
        const emptyStats = await getCodeStatistics(INVALID_PATH);
        const expected: CodeStatistics = {
            totalCommits: 0,
            linesAdded: 0,
            linesDeleted: 0,
            filesAdded: 0,
            filesModified: 0,
            filesDeleted: 0,
        };

        assert.deepStrictEqual(emptyStats, expected);
    });

    test("异常处理测试", async () => {
        // 模拟Git错误
        sandbox.stub(require("simple-git"), "simpleGit").throws(new Error("Mock Git Error"));

        try {
            await getCommitHistory(INVALID_PATH);
            assert.fail("应抛出异常");
        } catch (err) {
            assert.match((err as Error).message, /Mock Git Error/);
        }
    });

    test("性能基准测试", async () => {
        const start = Date.now();
        await getCommitHistory(TEST_REPO_PATH);
        const duration = Date.now() - start;

        assert.ok(duration < 1000, `获取提交历史耗时${duration}ms，超过1秒阈值`);
    });
});
