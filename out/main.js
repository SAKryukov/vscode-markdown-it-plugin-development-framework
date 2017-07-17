"use strict";

exports.activate = function (context) {

    const encoding = "utf8";
    const Utf8BOM = "\ufeff";
    const defaultSmartQuotes = '""' + "''";

    const vscode = require('vscode');
    const path = require('path');
    const fs = require('fs');
    const semantic = require('./semantic');

    const util = require('util');
    const jsonCommentStripper = require("./node_modules/strip-json-comments");
    const jsonFormatter = require("./node_modules/json-format");

    const previewAuthority = "markdown-debug-preview";
    const previewUri =
        vscode.Uri.parse(util.format("%s://authority/%s", previewAuthority, previewAuthority));
    
    let lastContent;

    const TextDocumentContentProvider = (function () {
        function TextDocumentContentProvider() {
            this.changeSourceHandler = new vscode.EventEmitter();
        } //TextDocumentContentProvider
        TextDocumentContentProvider.prototype.provideTextDocumentContent = function (uri) {
            if (lastContent)
                return lastContent;
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
        return path.join(rootPath, ".vscode", "markdown-it-debugging.settings.json");
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
            showLastHTML: true,
            createErrorLog: true,
            errorLogFile: "errors.log",
            showErrorLog: true
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
                { type: 'space', size: 4 }),
                function (err) {
                    vscode.window.showErrorMessage(err.toString());
                });
            vscode.workspace.openTextDocument(fileName, { preserveFocus: true }).then(function (doc) {
                vscode.window.showTextDocument(doc);
            });
        });
    }; //generateConfiguration

    const createMd = function (markDownPath, markdownItOptions, plugins) {
        const rootPath = vscode.workspace.rootPath;
        const errors = []; //SA???
        const constructor = require(markDownPath);
        let md = new constructor();
        markdownItOptions.xhtmlOut = true; //absolutely required default
        md.set(markdownItOptions);
        for (let index in plugins)
            try {
                const pluginPath = path.join(rootPath, plugins[index].path);
                const plugin = require(pluginPath);
                md.use(plugin, plugins[index].options);
            } catch (ex) {
                errors.push(ex.toString());
            } //exception
        return md;
    }; //createMd

    const htmlTemplateSet = semantic.getHtmlTemplateSet(path, fs, encoding);
    const runMd = function (md, debugConfiguration) {
        lastContent = undefined;
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
                lastFileName = output; 
                lastContent = result;
            } //if
        } //loop
        if (lastFileName && debugConfiguration.debugSessionOptions.showLastHTML) {
            vscode.commands.executeCommand(
                "vscode.previewHtml",
                previewUri,
                vscode.ViewColumn.One,
                util.format("Preview '%s'", path.basename(lastFileName)));
        } //if        
    }; //runMd

    const startDebugging = function (starter) {
        const extension = vscode.extensions.getExtension("Microsoft.vscode-markdown");
        if (!extension) return;
        const fileName = getConfigurationFileName(vscode.workspace.rootPath);
        if (!fs.existsSync(fileName)) {
            vscode.window.showInformationMessage("Edit debug configuration file and start debugger again. File names are relative to workspace.");
            generateConfiguration();
            return;
        } //if
        const json = fs.readFileSync(fileName, encoding);
        const debugConfiguration = JSON.parse(jsonCommentStripper(json));
        const extensionPath = path.join(extension.extensionPath, "node_modules");
        const pathToMd = path.join(extensionPath, "markdown-it");
        const md = createMd(pathToMd, debugConfiguration.markdownItOptions, debugConfiguration.plugins);
        runMd(md, debugConfiguration);
    }; //startDebugging

    context.subscriptions.push(
        vscode.commands.registerCommand("markdown.pluginDevelopment.start", function () {
            startDebugging();
        }));

    context.subscriptions.push(
        vscode.commands.registerCommand("markdown.pluginDevelopment.generateDebugConfiguration", function () {
            generateConfiguration();
        }));

}; //exports.activate

exports.deactivate = function deactivate() { }