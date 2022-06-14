// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ThemeColor } from "vscode";

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


	const provider1 = vscode.languages.registerCompletionItemProvider('plaintext', {

		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {

			// a simple completion item which inserts `Hello World!`
			const simpleCompletion = new vscode.CompletionItem('Hello World!');

			// a completion item that inserts its text as snippet,
			// the `insertText`-property is a `SnippetString` which will be
			// honored by the editor.
			const snippetCompletion = new vscode.CompletionItem('Good part of the day');
			snippetCompletion.insertText = new vscode.SnippetString('Good ${1|morning,afternoon,evening|}. It is ${1}, right?');
			const docs : any = new vscode.MarkdownString("Inserts a snippet that lets you select [link](x.ts).");
			snippetCompletion.documentation = docs;
			docs.baseUri = vscode.Uri.parse('http://example.com/a/b/c/');

			// a completion item that can be accepted by a commit character,
			// the `commitCharacters`-property is set which means that the completion will
			// be inserted and then the character will be typed.
			const commitCharacterCompletion = new vscode.CompletionItem('console');
			commitCharacterCompletion.commitCharacters = ['.'];
			commitCharacterCompletion.documentation = new vscode.MarkdownString('Press `.` to get `console.`');

			// a completion item that retriggers IntelliSense when being accepted,
			// the `command`-property is set which the editor will execute after 
			// completion has been inserted. Also, the `insertText` is set so that 
			// a space is inserted after `new`
			const commandCompletion = new vscode.CompletionItem('new');
			commandCompletion.kind = vscode.CompletionItemKind.Keyword;
			commandCompletion.insertText = 'new ';
			commandCompletion.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };

			let fakeSchemas = [
				'com.poplindata/click/1-0-0',
				'com.poplindata/click/2-0-0',
				'com.poplindata/view/1-0-0',
				'com.google/recaptcha/1-0-0'
			]

			// new type of events?
			const schemaCompletion = new vscode.CompletionItem('iglu:');
			schemaCompletion.insertText = new vscode.SnippetString('iglu:${1|' + fakeSchemas.join(',') + '|}')
			schemaCompletion.documentation = new vscode.MarkdownString('Attempts to autocomplete an Iglu reference');
			schemaCompletion.kind = vscode.CompletionItemKind.Constant;
			schemaCompletion.command = {
				command: 'editor.action.triggerSuggest',
				title: 'Retrigger'
			}

			// return all completion items as array
			return [
				simpleCompletion,
				snippetCompletion,
				commitCharacterCompletion,
				commandCompletion,
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

	// vscode.window.createTreeView('snowplowEnvironments', {
	// 	treeDataProvider: new NodeDependenciesProvider('.'),
	// })

	vscode.window.createTreeView('schemas', {
		treeDataProvider: new SchemasProvider('.')
	});

	vscode.window.createTreeView('enrichments', {
		treeDataProvider: new EnrichmentsProvider('.')
	});

	// 123



}

// this method is called when your extension is deactivated
export function deactivate() {}

export class SchemasProvider implements vscode.TreeDataProvider<Schema> {
	// This needs major revision, UI works but data structure
	// does not really make any sense
	constructor(private workspaceRoot: string) {}

	// let schemas = {
	// 	'com.poplindata': {
	// 		'click': {
	// 			'1-0-0': 'filename?/path',
	// 			'1-0-1': 'filename?/path'
	// 		}
	// 	}
	// }

	getTreeItem(element: Schema): vscode.TreeItem {
		return element;
	}

	getChildren(element?: Schema): Thenable<Schema[]> {

		if (element) {
			// get the schemas for this vendor

			if (element.type === 'vendor') {
				// get all events for this vendor
				var events = new Schema(
					'com.poplindata',
					'click',
					'1-0-0',
					'event',
					vscode.TreeItemCollapsibleState.Collapsed
				)
				return Promise.resolve([events]);
			}

			if (element.type === 'event') {
				// get all versions of this event
				var event = new Schema(
					'com.poplindata',
					'click',
					'1-0-0',
					'schema',
					vscode.TreeItemCollapsibleState.None
				)
				return Promise.resolve([event]);
			}

		} else {
			var x = new Schema(
				'com.poplindata',
				'click',
				'1-0-0',
				'vendor',
				vscode.TreeItemCollapsibleState.Collapsed
			)
			return Promise.resolve([x]);
		}
		return Promise.resolve([]);
	}
}

class Schema extends vscode.TreeItem {
	constructor(
		public readonly vendor: string,
		public readonly name: string,
		public readonly version: string,
		public readonly type: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState
	) {

		// if (type == 'vendor') {
		// 	super(vendor, collapsibleState);
		// } else if (type == 'event') {
		// 	super(name, collapsibleState);
		// }
		// super(name, collapsibleState);

		super(name, collapsibleState);

		if (type === 'vendor') {
			this.label = vendor;
			this.iconPath = new vscode.ThemeIcon('folder');
			this.description = '(n)';
		} else if (type === 'event') {
			this.label = name;
			this.iconPath = new vscode.ThemeIcon('folder');
			this.description = '(n)';
		} else {
			this.label = version;
			this.iconPath = new vscode.ThemeIcon('file')
		}

		this.tooltip = 'Hello tooltip';
		
		
	}
}


/// Todo: hookup to micro and allow easier debugging?

export class EnrichmentsProvider implements vscode.TreeDataProvider<Enrichment> {

	constructor(private workspaceRoot: string) {}

	getTreeItem(element: Enrichment): vscode.TreeItem {
		return element;
	}

	getChildren(element?: Enrichment): Thenable<Enrichment[]> {
			// technically no children
			// but maybe consider displaying jsonschema props?
			var c = new Enrichment(
				'currency conversion',
				'1-0-0',
				false
			);
			var d = new Enrichment(
				'data enrichment',
				'1-0-0',
				true
			);
			return Promise.resolve([c, d]);
	}

	editEntry(element: Enrichment) {
		console.log('do not do anything');
	}
}

class Enrichment extends vscode.TreeItem {
	constructor(
		public readonly name: string,
		public readonly version: string,
		public readonly enabled: boolean
	) {
		super(name, vscode.TreeItemCollapsibleState.None);
		this.tooltip = 'Hello tooltip';
		this.description = this.version;
		if (this.enabled === true) {
			this.iconPath = new vscode.ThemeIcon('pass-filled', new ThemeColor('terminal.ansiGreen'));
		} else {
			this.iconPath = new vscode.ThemeIcon('debug-breakpoint-unverified', new ThemeColor('problemsWarningIcon.foreground'));
		}
		// command logic
		const command = {
			'command': 'enrichments.editEnrichment',
		}
		// this.command = command;
	}
	

}


