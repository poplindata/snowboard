// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JsonSchemaFaker from 'json-schema-faker';
import faker from '@faker-js/faker';
import fetch from 'isomorphic-fetch';

import { EnvironmentsProvider, SchemasProvider, SchemasDragAndDropController } from './TreeViews';
import { AuthenticationProvider, TextDocumentContentProvider } from './SnowplowConsole';
import { SnippetService } from './SnippetService';

function makeIgluURI(path: string) {
	// make Iglu uri from local file path
	const [version, format, name, vendor] = path.split('/').reverse();
	return `iglu:${vendor}/${name}/${format}/${version}`;

}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated


	async function fetchIgluCentralSchemas(): Promise<string[]>{
		// fetch the manifest file for Iglu Central
		let schemas = fetch(
			'http://iglucentral.com/schemas',
			{
				headers: {
					'contentType': 'application/json'
				}
			}
		).then(function(response) {
			if (response.status >= 400) {
				console.log("some kind of error", response.status);
				return [];
			}
			return response.json();
		}).then(function(r) {
			return r;
		});
		return [];
	}

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
		JsonSchemaFaker.extend('faker', () => faker);
		JsonSchemaFaker.option({'alwaysFakeOptionals': true});
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



	context.subscriptions.push(
		vscode.commands.registerCommand('snowboard.newSchema', () => {
			// let success = vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
			createBrandNewSchema();
		}),
		vscode.commands.registerCommand('snowboard.newAddition', () => {
			createNewSchema("addition");
		}),
		vscode.commands.registerCommand('snowboard.newRevision', () => {
			createNewSchema("revision");
		}),
		vscode.commands.registerCommand('snowboard.newModel', () => {
			createNewSchema("model");
		}),
	);

	// get Iglu schemas
	let igluUris: string[] = [];

	const igluProvider = vscode.languages.registerCompletionItemProvider('*', {

		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {


			console.log('fetching schemas...');
			let res = fetchIgluCentralSchemas();
			console.log('schemas result:', res);
			let fakeSchemas = ["iglu:com.sendgrid/group_resubscribe/jsonschema/1-0-0"]

			// new type of events?
			const schemaCompletion = new vscode.CompletionItem('iglu:');
			schemaCompletion.insertText = new vscode.SnippetString('${1|' + fakeSchemas.join(',') + '|}');
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
	}, ":");

	const consoleAP = new AuthenticationProvider(context);
	const textDocProvider = new TextDocumentContentProvider(consoleAP);
	const schemasProvider = new SchemasProvider(consoleAP);

	context.subscriptions.push(consoleAP);
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(
			TextDocumentContentProvider.scheme,
			textDocProvider,
		)
	);

	context.subscriptions.push(
		vscode.window.createTreeView("schemas", {
			treeDataProvider: schemasProvider,
			dragAndDropController: new SchemasDragAndDropController(schemasProvider),
		}),
		vscode.window.createTreeView("environments", {
			treeDataProvider: new EnvironmentsProvider(consoleAP),
		}),
	);

	context.subscriptions.push(igluProvider);


	const selector: vscode.DocumentSelector = { language: '*' };


	const snippetService = new SnippetService(context.extension.extensionPath, context.extension.packageJSON);
	context.subscriptions.push(vscode.languages.registerDocumentDropEditProvider(selector, new ReverseTextOnDropProvider(snippetService, textDocProvider)));

}

class ReverseTextOnDropProvider implements vscode.DocumentDropEditProvider {
	constructor(private readonly snippetService: SnippetService, private readonly docProvider: TextDocumentContentProvider){}

	async provideDocumentDropEdits(
		_document: vscode.TextDocument,
		position: vscode.Position,
		dataTransfer: vscode.DataTransfer,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentDropEdit | undefined> {
		let vendor: string, event: string, format: string, version: string, uri: string;

		// Check the data transfer to see if we have some kind of text data

		let dataTransferItem = dataTransfer.get('text') ?? dataTransfer.get('text/plain');
		if (dataTransferItem) {
			const text = await dataTransferItem.asString();

			if (token.isCancellationRequested) return;

			// try and read the file (do we need to?)

			// Adding the reversed text
			uri = makeIgluURI(text);
			[vendor, event, format, version] = uri.replace('iglu:', '').split('/');
		} else {
			dataTransferItem = dataTransfer.get("text/uri-list");
			if (!dataTransferItem) return;

			const uriList = (await dataTransferItem.asString()).split("\n");
			if (token.isCancellationRequested) return;

			let hit: any | undefined = undefined;

			for (const dragUri of uriList) {
				if (dragUri.startsWith(TextDocumentContentProvider.scheme)) {
					try {
						const content = await this.docProvider.provideTextDocumentContent(vscode.Uri.parse(dragUri), token);
						const igluSchema = JSON.parse(content);
						if (typeof igluSchema === "object" && igluSchema && "self" in igluSchema) {
							hit = igluSchema;
							console.log("got schema for", dragUri, hit);
							break;
						}
					} catch {
						console.error("failed to parse json from", dragUri);
						continue;
					}
					if (token.isCancellationRequested) return;
				}
			}

			if (hit) {
				({vendor, name: event, format, version} = hit["self"]);
				uri = makeIgluURI([vendor, event, format, version].join("/"));
			} else return;
		}

		const [model, revision, addition] = version.split('-');

		// Build a snippet to insert
		let snippet = new vscode.SnippetString();
		// lookup the appropriate snippet
		// languageId should probably be .js or .ts or something
		// and based on this languageId we should select the snippet that we are
		// interested in!
		const predefined = this.snippetService.getSnippets(_document.languageId, "Send self-describing JSON");
		if (predefined && predefined.length == 1) snippet = this.snippetService.evaluate(predefined[0], {
			vendor, event, format, version, uri, model, revision, addition,
			"iglu:com.example/example/jsonschema/1-0-0": uri,
		});

		// TODO: need to write sdjson snippets for each language
		// TODO: how do we determine the destination file type / syntax?

		// can we do smart insert based on line number
		// and whether the object has been dragged
		// into an existing event or not?
		// we get a line and a character number
		// but no surrounding text?

		// none of the "official" return values from provideDocumentDropEdits treat snippets properly
		// instead we use insertSnippet to actually get decent indentation & tabstop behavior
		if (_document === vscode.window.activeTextEditor?.document && snippet.value) {
			return vscode.window.activeTextEditor.insertSnippet(snippet, position).then((success) => success ? {insertText: ""} : undefined);
		} else {
			vscode.window.showInformationMessage(`Unable to generate snippet code for language: ${_document.languageId}`);
		}
	}
}

// this method is called when your extension is deactivated
export function deactivate() {}
