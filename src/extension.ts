// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ThemeColor } from "vscode";
import common = require('mocha/lib/interfaces/common');
import JsonSchemaFaker from 'json-schema-faker';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "snowboard" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('snowboard.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from snowboarding!');
	});

	let micro = vscode.commands.registerCommand('snowboard.openMicro', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		// vscode.window.showInformationMessage('Hello World from snowboarding!');
		// vscode.open('https://localhost:9090/micro/all');
		let microUri = 'http://localhost:9090/micro/all';
		let success = vscode.commands.executeCommand('vscode.open', microUri, 1);

		// probably makes more sense to open this as a webview...

	});



	function handleResult<T>(resolve: (result: T) => void, reject: (error: Error) => void, error: Error | null | undefined, result: T): void {
		if (error) {
			reject(massageError(error));
		} else {
			resolve(result);
		}
	}

	function massageError(error: Error & { code?: string }): Error {
		if (error.code === 'ENOENT') {
			return vscode.FileSystemError.FileNotFound();
		}

		if (error.code === 'EISDIR') {
			return vscode.FileSystemError.FileIsADirectory();
		}

		if (error.code === 'EEXIST') {
			return vscode.FileSystemError.FileExists();
		}

		if (error.code === 'EPERM' || error.code === 'EACCESS') {
			return vscode.FileSystemError.NoPermissions();
		}

		return error;
	}

	function writefile(path: string, content: Buffer): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			fs.writeFile(path, content, error => handleResult(resolve, reject, error, void 0));
		});
	}

	function incrementSchemaVersion(component: string, schema: string): { version: string, schema: string} {
		// replacy replacy
		let snowplowSchema = JSON.parse(schema); // try
		let newVersion = '1-0-0';
		let version: string = snowplowSchema.self.version;
		let versionSplit = version.split("-");
		if (component === 'addition') {
			let currentAddition: number = parseInt(versionSplit[2]) + 1;
			newVersion = `${versionSplit[0]}-${versionSplit[1]}-${currentAddition}`;
		} else if (component === 'revision') {
			let currentRevision: number = parseInt(versionSplit[1]) + 1;
			newVersion = `${versionSplit[0]}-${currentRevision}-0`;
		} else {
			// assume model change
			let currentModel: number = parseInt(versionSplit[0]) + 1;
			newVersion = `${currentModel}-0-0`;
		}
		
		snowplowSchema.self.version = newVersion;

		return {
			'version': newVersion,
			'schema': JSON.stringify(snowplowSchema, null, 4)
		};
	}


	function createBrandNewSchema(){
		// todo: name this better
		let success = vscode.commands.executeCommand('workbench.action.files.newUntitledFile').then(x => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				let news = `
{
	"\\$schema": "http://iglucentral.com/schemas/com.snowplowanalytics.self-desc/schema/jsonschema/1-0-0#",
	"self": {
		"vendor": "\${1:${vscode.workspace.getConfiguration('snowboard').get('defaultVendor')}}",
		"name": "\${2:example}",
		"format": "jsonschema",
		"version": "\${3:1-0-0}"
	},
	"description": "\${4:description}",
	"type": "object",
	"properties": {
		$0
	}
}
				`;

				let snippet = new vscode.SnippetString(news);
				editor.insertSnippet(snippet);
			} else {
				vscode.window.showInformationMessage('no editor');
			}
		});		
	}

	function createNewSchema(component: string) {
		const wsedit = new vscode.WorkspaceEdit();
		if (!vscode.workspace.workspaceFolders) {
			vscode.window.showInformationMessage("A folder or workspace must be opened to use this command.");
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (editor) {
			let currentDirectory = path.dirname(editor.document.uri.fsPath);
			let document = editor.document;
			const documentText = document.getText();
			let newSchema = incrementSchemaVersion(component, documentText);

			const newPath = path.join(currentDirectory, newSchema.version);
			writefile(newPath, Buffer.from(newSchema.schema));
			// now open the newly created schema
			vscode.workspace.openTextDocument(newPath).then(doc => {
				vscode.window.showTextDocument(doc);
			});
		}
	}

	let newExampleData = vscode.commands.registerCommand('snowboard.generateFakeData', () => {
		// determine the current file / selected schema
		// TODO: consider faker support here
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			let currentDirectory = path.dirname(editor.document.uri.fsPath);
			let document = editor.document;
			const documentText = document.getText();
			
			const schema = JSON.parse(documentText); // TODO: try-catch

			// TODO: see if there's an option to prevent generating additional properties
			const example = JsonSchemaFaker.generate(schema);

			vscode.workspace.openTextDocument({
				content: JSON.stringify(example, null, 4),
				language: "json"
			}).then(newDocument => {
				vscode.window.showTextDocument(newDocument);
			});

		} else {
			vscode.window.showErrorMessage("A schema file must be opened in order to generate data.");
		}


	});

	let newSchema = vscode.commands.registerCommand('snowboard.newSchema', () => {
		// let success = vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
		createBrandNewSchema();
	});

	let newAddition = vscode.commands.registerCommand('snowboard.newAddition', () => {
		createNewSchema("addition");
	});

	let newRevision = vscode.commands.registerCommand('snowboard.newRevision', () => {
		createNewSchema("revision");
	});

	let newModel = vscode.commands.registerCommand('snowboard.newModel', () => {
		createNewSchema("model");
	});

	let openDebugger = vscode.commands.registerCommand('snowboard.openMicroDebugger', () => {
		const panel = vscode.window.createWebviewPanel(
			'Micro Debugger',
			'Micro Debugger',
			vscode.ViewColumn.Two,
			{
				enableScripts: true
			}
		);
		panel.webview.html = '<iframe src="http://localhost:3000" style="border: medium none; width: 100%; height: 1000px;"></iframe>';
	});

	// command to create new untitled file
	// workbench.action.files.newUntitledFile


	const provider1 = vscode.languages.registerCompletionItemProvider('*', {

		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {

			
			// TODO: enumerate schemas from local 'schemas' directory
			// in the future we could pull these manifests from remote repositories
			let fakeSchemas = [
				'com.poplindata/click/1-0-0',
				'com.poplindata/click/2-0-0',
				'com.poplindata/view/1-0-0',
				'com.google/recaptcha/1-0-0'
			];

			// new type of events?
			const schemaCompletion = new vscode.CompletionItem('iglu:');
			schemaCompletion.insertText = new vscode.SnippetString('iglu:${1|' + fakeSchemas.join(',') + '|}');
			schemaCompletion.documentation = new vscode.MarkdownString('Attempts to autocomplete an Iglu reference');
			schemaCompletion.kind = vscode.CompletionItemKind.Constant;
			schemaCompletion.command = {
				command: 'editor.action.triggerSuggest',
				title: 'Retrigger'
			};

			// return all completion items as array
			return [
				schemaCompletion
			];
		}
	});

	context.subscriptions.push(provider1);


	let x = vscode.commands.registerCommand('enrichments.editEnrichment', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('You are trying to edit an enrichment');
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(micro);
	context.subscriptions.push(newSchema);

	// vscode.window.createTreeView('snowplowEnvironments', {
	// 	treeDataProvider: new NodeDependenciesProvider('.'),
	// })

	// vscode.window.createTreeView('schemas', {
	// 	treeDataProvider: new SchemasProvider('.')
	// });

	// vscode.window.createTreeView('enrichments', {
	// 	treeDataProvider: new EnrichmentsProvider('.')
	// });

}

// this method is called when your extension is deactivated
export function deactivate() {}

