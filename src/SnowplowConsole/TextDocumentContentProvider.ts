import * as vscode from "vscode";

import { AuthenticationProvider } from "./AuthenticationProvider";

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
  implements
    vscode.TextDocumentContentProvider,
    vscode.DocumentLinkProvider,
    vscode.Disposable
{
  public static scheme = CONSOLE_URI_SCHEMA;

  private resolver: Map<string, Set<string>>;

  constructor(private readonly _authProvider: AuthenticationProvider) {
    this.resolver = new Map();
  }

  dispose() {
    this.resolver.clear();
  }

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

  public addToResolver(uri: vscode.Uri, schema: unknown): void {
    if (typeof schema === "object" && schema != null && "self" in schema) {
      const { self } = schema as Record<"self", unknown>;

      if (typeof self === "object" && self) {
        const { vendor, name, format, version } = self as Record<
          string,
          unknown
        >;
        const iglu = `${TextDocumentContentProvider.scheme}:${vendor}/${name}/${format}/${version}`;

        const results = this.resolver.get(iglu) || new Set();

        results.add(uri.toString());

        this.resolver.set(iglu, results);
      }
    }
  }

  async provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<string> {
    const organizationId = uri.authority;

    if (organizationId) {
      const [_, schemaHash, format, version] = uri.path.split("/");
      const env = uri.query || "";

      const schema = await this._authProvider.consoleApiRequest(
        `/data-structures/v1/${schemaHash}/versions/${version}${env}`,
        organizationId
      );

      this.addToResolver(uri, schema);

      return JSON.stringify(schema, null, 2);
    } else if (uri.path && uri.fragment) {
      const [_, vendor, name, format, version] = uri.path.split("/");
      const staticUri = vscode.Uri.joinPath(
        vscode.Uri.parse(uri.fragment),
        vendor,
        name,
        format,
        version
      );

      const schema = await fetch(staticUri.toString()).then((r) =>
        r.ok ? r.json() : Promise.reject(r)
      );
      this.addToResolver(uri, schema);
      return JSON.stringify(schema, null, 2);
    } else if (uri.fragment) {
      const schema = JSON.parse(decodeURIComponent(uri.fragment));
      this.addToResolver(uri, schema);
      return JSON.stringify(schema, null, 2);
    } else {
      const options = this.resolver.get(uri.toString());
      if (options) {
        const option = Array.from(options.values())[0];
        if (option) {
          return this.provideTextDocumentContent(
            vscode.Uri.parse(option),
            token
          );
        }

        const [vendor, name, format, version] = uri.path.split("/");
        return JSON.stringify(
          {
            self: { vendor, name, format, version },
            ...EMPTY_SCHEMA,
          },
          null,
          2
        );
      } else {
        return "";
      }
    }
  }
}
