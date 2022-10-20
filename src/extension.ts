// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JsonSchemaFaker from 'json-schema-faker';
import faker from '@faker-js/faker';
import fetch from 'isomorphic-fetch';

import { EnvironmentsProvider, SchemasProvider } from './TreeViews';
import { AuthenticationProvider, TextDocumentContentProvider } from './SnowplowConsole';

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



	async function listLocalSchemas(): Promise<string[]> {
		// list local schemas
		const wsedit = new vscode.WorkspaceEdit();
		if (!vscode.workspace.workspaceFolders) {
			vscode.window.showInformationMessage("A folder or workspace must be opened to use this command.");
			return [];
		}

		let workspaceFolderPath: string = vscode.workspace.workspaceFolders[0].uri.path;

		const resources = await vscode.workspace.findFiles('schemas/*/*/*/*');
		const schemas = await Promise.all(resources.map(file => makeIgluURI(file.path)));

		return schemas;

	}

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

	// get Iglu schemas
	let igluUris: string[] = [];

	// let remoteSchemas = fetchIgluCentralSchemas().then(function(x) {console.log('schemas:', x)});
	let localSchemas = listLocalSchemas().then(x => igluUris.concat(x));
	console.log('schemas length:', igluUris);

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
	});

	const consoleAP = new AuthenticationProvider(context);

	context.subscriptions.push(consoleAP);
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(
			TextDocumentContentProvider.scheme,
			new TextDocumentContentProvider(consoleAP),
		)
	);
	context.subscriptions.push(
		vscode.window.createTreeView("schemas", {
			treeDataProvider: new SchemasProvider(consoleAP),
		}),
		vscode.window.createTreeView("environments", {
			treeDataProvider: new EnvironmentsProvider(consoleAP),
		}),
	);

	context.subscriptions.push(igluProvider);

	context.subscriptions.push(newSchema);

	const selector: vscode.DocumentSelector = { language: '*' };


	context.subscriptions.push(vscode.languages.registerDocumentDropEditProvider(selector, new ReverseTextOnDropProvider()));

}

class ReverseTextOnDropProvider implements vscode.DocumentDropEditProvider {
	async provideDocumentDropEdits(
		_document: vscode.TextDocument,
		position: vscode.Position,
		dataTransfer: vscode.DataTransfer,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentDropEdit | undefined> {
		// Check the data transfer to see if we have some kind of text data
		const dataTransferItem = dataTransfer.get('text') ?? dataTransfer.get('text/plain');
		if (!dataTransferItem) {
			return undefined;
		}

		const text = await dataTransferItem.asString();
		if (token.isCancellationRequested) {
			return undefined;
		}

		// try and read the file (do we need to?)

		// Build a snippet to insert
		const snippet = new vscode.SnippetString();
		// Adding the reversed text
		const x = makeIgluURI(text);
		const [vendor, event, format, version] = x.replace('iglu:', '').split('/');
		const [model, revision, addition] = version.split('-');
		const dropFilePath = _document.uri.fsPath;	

		var snip: string = '';
		if (_document.languageId === 'javascript'){
			snip += `
trackSelfDescribingEvent({
	event: {
		schema: '${x}',
		data: {}
	}
});`;
		}
		else if (_document.languageId === 'objective-c') {
			console.log('hi inserting objc code');
			snip += `
let event = SelfDescribing(schema: "${x}", payload: []);
tracker.track(event);
			`;
		}
		else if (_document.languageId === 'java'){
			// is there a more specific language for Android?
			snip += 
`SelfDescribingJson json = new SelfDescribingJson("${x}", data);
SelfDescribing event = new SelfDescribing(json);
`;		
		}
		else if (_document.languageId === 'csharp') {
			snip += 
`
SelfDescribingJson json = new SelfDescribingJson(\"${x}\", data);
`
		}
		else if (_document.languageId === 'php') {
			// TODO: this needs a different schema version!
			let phpSchema = `iglu:${vendor}/${event}/${format}/${model}.${revision}.${addition}`
			snip +=
`
$tracker->trackUnstructEvent(
    array(
        "schema" => "${phpSchema}",
        "data" => array(
            
        )
    )
);`
		}
		else if (_document.languageId === 'cpp'){
			snip += 
`
SelfDescribingJson sdj("${x}", data);
SelfDescribingEvent sde(sdj);
Snowplow::get_default_tracker()->track(sde);
`
		}
		else if (_document.languageId === 'ruby') {
			snip +=
`
self_desc_json = SnowplowTracker::SelfDescribingJson.new(
	"${x}",
	{}
)
tracker.track_self_describing_event(self_desc_json)
`
		}
		else if (_document.languageId === 'scala'){
			// TODO: this needs to look different!
			snip +=
`
val event = SelfDescribingJson(
	SchemaKey(${vendor}, ${event}, ${format}, SchemaVer(${model},${revision},${addition})),
	Json.obj()
)
tracker.trackSelfDescribingEvent(event)
`
		}
		else if (_document.languageId === 'python') {
			snip +=
`
tracker.track_self_describing_event(SelfDescribingJson(
	"${x}",
	{}
))
`
		}
		else if (_document.languageId === 'go') {
			snip += 
`
sdj := sp.InitSelfDescribingJson("${x}", data)

tracker.TrackSelfDescribingEvent(sp.SelfDescribingEvent{
  Event: sdj,
})
`
		}
		else if (_document.languageId === 'dart') {
			snip += 
`
tracker.track(SelfDescribing(
    schema: '${x}',
    data: {}
));
`
		}
		else if (_document.languageId === 'lua') {
			snip +=
`
tracker:track_self_describing_event(
	"${x}",
	{ }
)
`		}
		else {
			vscode.window.showInformationMessage(`Unable to generate snippet code for language: ${_document.languageId}`);
		}
		
		// lookup the appropriate snippet



		// languageId should probably be .js or .ts or something
		// and based on this languageId we should select the snippet that we are
		// interested in!

		// TODO: need to write sdjson snippets for each language
		// TODO: how do we determine the destination file type / syntax?

		// can we do smart insert based on line number
		// and whether the object has been dragged
		// into an existing event or not?
		// we get a line and a character number
		// but no surrounding text?
		snippet.appendText([...snip].join(''));
		// snippet.appendTabstop()

		return { insertText: snippet };
	}
}

// this method is called when your extension is deactivated
export function deactivate() {}

