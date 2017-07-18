"use strict";

exports.activate = function (context) {

    const encoding = "utf8";
    const Utf8BOM = "\ufeff";
    const defaultSmartQuotes = '“”' + "‘’";
    const formatProcessed = "Processed by plug-ins: \"%s\"";

    const vscode = require("vscode");
    const path = require("path");
    const fs = require("fs");
    const util = require("util");
    const importContext = { vscode: vscode, util: util, fs: fs, path: path };
    const semantic = require("./semantic");

    const jsonCommentStripper = require("./node_modules/strip-json-comments");
    const jsonFormatter = require("./node_modules/json-format");
    const tmp = require("./node_modules/tmp");

    const previewAuthority = "markdown-debug-preview";
    const previewUri =
        vscode.Uri.parse(util.format("%s://authority/%s", previewAuthority, previewAuthority));

    const TextDocumentContentProvider = (function () {
        function TextDocumentContentProvider() {
            this.changeSourceHandler = new vscode.EventEmitter();
        } //TextDocumentContentProvider
        TextDocumentContentProvider.prototype.provideTextDocumentContent = function (uri) {
            if (vscode.workspace.lastContent)
                return vscode.workspace.lastContent;
            vscode.workspace.lastContent = null;
        }; //TextDocumentContentProvider.prototype.provideTextDocumentContent
        Object.defineProperty(TextDocumentContentProvider.prototype, "onDidChange", {
            get: function () { return this.changeSourceHandler.event; }, enumerable: true, configurable: true
        });
        TextDocumentContentProvider.prototype.update = function (uri) {
            this.changeSourceHandler.fire(uri);
        }; //TextDocumentContentProvider.prototype.update
        return TextDocumentContentProvider;
    }()); //TextDocumentContentProvider
    const provider = new TextDocumentContentProvider();
    const registration = vscode.workspace.registerTextDocumentContentProvider(previewAuthority, provider);

    const getConfigurationFileName = function (rootPath) {
        if (!vscode.workspace.settings)
            vscode.workspace.settings = semantic.getSettings(importContext);
        const dirName = path.join(rootPath, ".vscode");
        try {
            fs.mkdirSync(dirName);
        } catch (ex) { }
        return path.join(dirName, vscode.workspace.settings.debugConfigurationFileName);
    }; //getConfigurationFileName

    const defaultConfiguration = {
        markdownItOptions: {
            html: true,
            linkify: false,
            breaks: false,
            typographer: true,
            quotes: defaultSmartQuotes
        },
        plugins: [],
        testDataSet: [],
        debugSessionOptions: {
            saveHtmlFiles: true,
            showLastHTML: true
        }
    }; //defaultConfiguration

    const collectFiles = function (action) {
        const rootPath = vscode.workspace.rootPath;
        vscode.workspace.findFiles("**/*.md").then(function (markdownFiles) {
            vscode.workspace.findFiles("**/package.json").then(function (packageFiles) {
                const markdownDocuments = [];
                const plugins = [];
                for (let index = 0; index < markdownFiles.length; ++index)
                    markdownDocuments.push(
                        path.relative(rootPath, markdownFiles[index].fsPath));
                for (let index = 0; index < packageFiles.length; ++index)
                    plugins.push({
                        enabled: true,
                        path: path.relative(rootPath, path.dirname(packageFiles[index].fsPath)),
                        options: {}
                    });
                action(markdownDocuments, plugins);
            });
        });
    }; //collectFiles

    const generateConfiguration = function () {
        const rootPath = vscode.workspace.rootPath;
        if (!rootPath) {
            vscode.window.showWarningMessage("Markdown debugging requires open folder and workspace");
            return;
        } //if
        const configuration = defaultConfiguration;
        configuration.plugins = [];
        configuration.testDataSet = [];
        collectFiles(function (markdownFiles, plugins) {
            configuration.plugins = plugins;
            configuration.testDataSet = markdownFiles;
            const fileName = getConfigurationFileName(rootPath);
            fs.writeFileSync(fileName, jsonFormatter(
                configuration,
                { type: "space", size: 4 }),
                function (err) {
                    vscode.window.showErrorMessage(err.toString());
                });
            vscode.workspace.openTextDocument(fileName, { preserveFocus: true }).then(function (doc) {
                vscode.window.showTextDocument(doc);
            });
            if (configuration.plugins.length < 1)
                vscode.window.showWarningMessage("Create at least one plug-in and try again. Plug-in is recognized by the file \"package.json\".");
            if (configuration.testDataSet.length < 1)
                vscode.window.showWarningMessage("Create at least one Markdown document (.md) and try again");
        });
    }; //generateConfiguration

    const createMd = function (markdownPath, markdownItOptions, plugins) {
        const rootPath = vscode.workspace.rootPath;
        const constructor = require(markdownPath);
        const md = new constructor();
        markdownItOptions.xhtmlOut = true; //absolutely required default
        md.set(markdownItOptions);
        for (let index in plugins) {
            const plugin = plugins[index]; 
            if (!plugin.enabled) continue;
            try {
                const pluginPath = path.join(rootPath, plugin.path);
                const plugin = require(pluginPath);
                md.use(plugin, plugin.options);
            } catch (ex) {
                errors.push(ex.toString());
            } //exception
        } //loop
        return md;
    }; //createMd

    const templateSet = semantic.getTemplateSet(path, fs, encoding);
    const runMd = function (md, debugConfiguration) {
        vscode.workspace.lastContent = undefined;
        const rootPath = vscode.workspace.rootPath;
        let lastFileName;
        for (let index in debugConfiguration.testDataSet) {
            const inputFileName = path.join(rootPath, debugConfiguration.testDataSet[index]);
            let result = md.render(fs.readFileSync(inputFileName, encoding));
            console.log(result);
            if (debugConfiguration.debugSessionOptions.saveHtmlFiles) {
                // const effectiveOutputPath = outputPath ?
                //     path.join(vscode.workspace.rootPath, outputPath) : path.dirname(fileName);
                const effectiveOutputPath = path.dirname(inputFileName);
                result = Utf8BOM + result;
                const output = path.join(
                    effectiveOutputPath,
                    path.basename(inputFileName,
                        path.extname(inputFileName))) + ".html";
                fs.writeFileSync(output, result);
                lastFileName = inputFileName;
                vscode.workspace.lastContent = result;
            } //if
        } //loop
        if (debugConfiguration.testDataSet.length < 1) return;
        if (!lastFileName)
            for (let index in debugConfiguration.testDataSet)
                lastFileName = path.join(rootPath, debugConfiguration.testDataSet[index]);
        if (lastFileName && debugConfiguration.debugSessionOptions.showLastHTML) {
            vscode.commands.executeCommand(
                "vscode.previewHtml",
                previewUri,
                vscode.ViewColumn.One,
                util.format(formatProcessed, path.basename(lastFileName)));
        } //if        
    }; //runMd

    const getMdPath = function () {
        const extension = vscode.extensions.getExtension("Microsoft.vscode-markdown");
        if (!extension) return;
        const extensionPath = path.join(extension.extensionPath, "node_modules");
        return path.join(extensionPath, "markdown-it");
    }; //getMdPath

    const readConfiguration = function () {
        const fileName = getConfigurationFileName(vscode.workspace.rootPath);
        if (!fs.existsSync(fileName)) {
            generateConfiguration();
            vscode.window.showInformationMessage("Edit debug configuration file and start debugger again. File names are relative to workspace.");
            return;
        } //if
        const json = fs.readFileSync(fileName, encoding);
        return JSON.parse(jsonCommentStripper(json));
    }; //readConfiguration

    const startWithoutDebugging = function (starter) {
        const pathToMd = getMdPath();
        if (!pathToMd) return;
        const debugConfiguration = readConfiguration();
        const md = createMd(pathToMd, debugConfiguration.markdownItOptions, debugConfiguration.plugins);
        runMd(md, debugConfiguration);
    }; //startWithoutDebugging

    const startDebugging = function () {
        const pathToMd = semantic.unifyFileString(getMdPath());
        if (!pathToMd) return;
        const rootPath = vscode.workspace.rootPath;
        const launchConfiguration = {
            type: "node2", // a real confusion! found by tracing Visual Studio Code
            name: "Launch Extension",
            request: "launch",
            stopOnEntry: false,
            protocol: "auto"
        };
        const debugConfiguration = readConfiguration();
        if (!debugConfiguration) return;
        const debugConfigurationString = jsonFormatter(
            debugConfiguration,
            { type: "space", size: 2 });
        let doWatch = false;
        if (!vscode.workspace.tmpDir) {
            vscode.workspace.tmpDir = tmp.dirSync({ unsafeCleanup: true, prefix: "vscode.markdown-debugging-", postfix: ".tmp.js" });
            doWatch = true;
        } //if
        const dirName = vscode.workspace.tmpDir.name;
        const htmlFileName = semantic.unifyFileString(path.join(dirName, "last.html"));
        const lastFileFileName = semantic.unifyFileString(path.join(dirName, "lastFileName.txt"));
        const code = util.format(
            templateSet.driver,
            debugConfigurationString,
            semantic.unifyFileString(pathToMd),
            semantic.unifyFileString(rootPath),
            htmlFileName,
            lastFileFileName);
        launchConfiguration.program = path.join(dirName, "driver.js");
        fs.writeFileSync(launchConfiguration.program, code);
        vscode.commands.executeCommand("vscode.startDebug", launchConfiguration);
        const watchCompleted = { content: undefined, fileName: undefined };
        if (doWatch) fs.watch(vscode.workspace.tmpDir.name, function (event, fileName) {
            fileName = path.basename(fileName).toLowerCase();
            if (fs.existsSync(htmlFileName) && path.basename(htmlFileName).toLowerCase() == fileName)
                watchCompleted.content = htmlFileName;
            if (fs.existsSync(lastFileFileName) && path.basename(lastFileFileName).toLowerCase() == fileName)
                watchCompleted.fileName = lastFileFileName;
            if (watchCompleted.content && watchCompleted.fileName) {
                const lastFileName = fs.readFileSync(watchCompleted.fileName, encoding);
                vscode.workspace.lastContent = fs.readFileSync(watchCompleted.content, encoding);
                vscode.commands.executeCommand(
                    "vscode.previewHtml",
                    previewUri,
                    vscode.ViewColumn.One,
                    util.format(formatProcessed, path.basename(lastFileName)));
                watchCompleted.content = undefined;
                watchCompleted.fileName = undefined;
            } //if
        });
    }; //startDebugging

    vscode.workspace.onDidChangeConfiguration(function (e) {
        vscode.workspace.settings = undefined;
    }); //vscode.workspace.onDidChangeConfiguration

    context.subscriptions.push(
        vscode.commands.registerCommand("markdown.pluginDevelopment.startWithoutDebugging", function () {
            startWithoutDebugging();
        }));

    context.subscriptions.push(
        vscode.commands.registerCommand("markdown.pluginDevelopment.startDebugging", function () {
            startDebugging();
        }));

    context.subscriptions.push(
        vscode.commands.registerCommand("markdown.pluginDevelopment.generateDebugConfiguration", function () {
            generateConfiguration();
        }));

}; //exports.activate

exports.deactivate = function deactivate() {
    if (vscode.workspace.tmpDir)
        vscode.workspace.tmpDir.removeCallback();
}; //exports.deactivate