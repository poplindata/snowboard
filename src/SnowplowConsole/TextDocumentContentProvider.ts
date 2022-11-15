import * as vscode from "vscode";

import { SchemaService } from "../SchemaService";

const CONSOLE_URI_SCHEMA = "iglu+console" as const;
const IGLU_PATTERN =
  /iglu:[a-zA-Z0-9-_.]+\/[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+\/[0-9]+-[0-9]+-[0-9]+/g;

const EMPTY_SCHEMA = {
  $schema:
    "http://iglucentral.com/schemas/com.snowplowanalytics.self-desc/schema/jsonschema/1-0-0#",
  description: "This is a new empty schema for the unrecognized Iglu URI.",
  type: "object",
  properties: {},
};

export class TextDocumentContentProvider
  implements vscode.TextDocumentContentProvider, vscode.DocumentLinkProvider
{
  public static scheme = CONSOLE_URI_SCHEMA;

  constructor(private readonly schemaService: SchemaService) {}

  provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentLink[]> {
    return document
      .getText()
      .split("\n")
      .flatMap((line, lineNumber): [string, vscode.Range][] => {
        const matches = Array.from(line.matchAll(IGLU_PATTERN));
        return matches.map((m) => [
          m[0],
          new vscode.Range(
            new vscode.Position(lineNumber, m.index!),
            new vscode.Position(lineNumber, m.index! + m[0].length)
          ),
        ]);
      })
      .flatMap(([uri, range]) => [
        new vscode.DocumentLink(
          range,
          vscode.Uri.parse(
            uri.replace(/^iglu/, TextDocumentContentProvider.scheme)
          )
        ),
      ]);
  }

  async provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<string> {
    let selector: any;

    if (
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        uri.authority
      )
    ) {
      const path = uri.path.split("/");
      console.assert(
        path.length === 4,
        "unexpected path components resolving console uri",
        uri
      );
      const [_, contentHash, format, version] = path;
      selector = {
        registry: { kind: "organization", id: uri.authority },
        igluUri: { format, version },
        hash: contentHash,
      };
    } else if (uri.authority) {
      const path = uri.path.split("/").reverse();
      const [version, format, name, vendor] = path;

      selector = {
        registry: {
          kind: "static",
          id: (orgId: string) => orgId.includes(uri.authority),
        },
        igluUri: { vendor, name, format, version },
      };
    } else {
      selector = { igluUri: uri.with({ scheme: "iglu" }).toString() };
    }

    let cancellationDisposal: vscode.Disposable | undefined = undefined;
    const cancel = new Promise(
      (_, reject) =>
        (cancellationDisposal = token.onCancellationRequested(reject))
    ).finally(() => cancellationDisposal && cancellationDisposal.dispose());

    await Promise.race([this.schemaService.discover(), cancel]);

    const matches = this.schemaService.getSchemas(selector);
    const exacts = matches.filter(
      (sd) => !uri.query || (sd.env && uri.query && uri.query.includes(sd.env))
    );

    return Promise.race([
      Promise.any(exacts.map((sd) => this.schemaService.resolve(sd))),
      cancel,
    ])
      .catch(() => ({
        self: {
          vendor: "vendor",
          name: "name",
          format: "jsonschema",
          version: "1-0-0",
        },
        ...EMPTY_SCHEMA,
      }))
      .then((schema) => JSON.stringify(schema, null, 2));
  }
}
