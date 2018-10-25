/* --------------------------------------------------------------------------------------------
 * Copyright (c) XiaoMi Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
	createConnection,
	TextDocuments,
	TextDocument,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
} from 'vscode-languageserver';
import { Range } from "vscode-languageserver/lib/main";
import { exec } from 'child_process'; 

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
	let capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we will fall back using global settings
	hasConfigurationCapability =
		capabilities.workspace && !!capabilities.workspace.configuration;
	hasWorkspaceFolderCapability =
		capabilities.workspace && !!capabilities.workspace.workspaceFolders;
	return {
		capabilities: {
			textDocumentSync: documents.syncKind
		}
	};
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(
			DidChangeConfigurationNotification.type,
			undefined
		);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface SoarSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: SoarSettings = { maxNumberOfProblems: 1000 };
let globalSettings: SoarSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<SoarSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <SoarSettings>(
			(change.settings.soar || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

// TODO
function getDocumentSettings(resource: string): Thenable<SoarSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'soar'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

documents.onDidSave(change => {
	validateTextDocument(change.document);
});

documents.onDidOpen(open => {
	validateTextDocument(open.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	let diagnostics: Diagnostic[] = [];
	let filePath =  textDocument.uri.replace("file://","")
	exec('cat '+filePath+' | soar -report-type lint',
		function(error,stdout,stderr){
			if (error){
				connection.console.log(error.message)
			}

			if (stderr){
				connection.console.log(stderr)
			}

			if (stdout){	
				let messages = stdout.split('\n');
				
				// remove last item
				messages.pop()
				for (let msg of messages){
					if ( msg.trim() === "" ) {
						continue
					}

					let info = msg.split(':');
					let line = Number(info[1])-1
					
					let range: Range = {
						start: {line, character: 1},
						end: {line, character: 1},
					};

					let diagnosic: Diagnostic = {
						severity: DiagnosticSeverity.Warning,
						range: range,
						message: `${info[2]}`,
						source: 'soar'
					};

					if (typeof diagnosic.message === 'undefined' || diagnosic.message === 'undefined') {
						continue
					}

					diagnostics.push(diagnosic);
				}
			}

			if (diagnostics.length > 0) {
				connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
			}
		})
}

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
