import * as vscode from "vscode";

import { AuthenticationProvider } from "./AuthenticationProvider";

const CONSOLE_URI_SCHEMA = "iglu+console" as const;

export class TextDocumentContentProvider
  implements vscode.TextDocumentContentProvider
{
  public static scheme = CONSOLE_URI_SCHEMA;
  constructor(private readonly _authProvider: AuthenticationProvider) {}

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
      return JSON.stringify(schema, null, 2);
    } else {
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
      return JSON.stringify(schema, null, 2);
    }
  }
}
