import { createHash } from "crypto";

import * as vscode from "vscode";
import fetch from "isomorphic-fetch";

import {
  AuthenticationProvider,
  TextDocumentContentProvider,
} from "../SnowplowConsole";

type DataStructureResource = {
  organizationId: string;
  hash: string;
  vendor: string;
  name: string;
  format: string;
  description?: string;
  meta: {
    schemaType?: "event" | "entity";
  };
  deployments: {
    version: string;
    patchLevel: number;
    contentHash: string;
    env: string;
  }[];
};

type SchemaProviderElement =
  | { kind: "workspace"; repoName: string; uri: vscode.Uri }
  | { kind: "static"; baseUrl: string; manifest: string; repoName: string }
  | { kind: "organization"; organizationId: string; organization: string }
  | { kind: "vendor"; organizationId: string; vendor: string }
  | { kind: "name"; organizationId: string; vendor: string; name: string }
  | {
      kind: "format";
      organizationId: string;
      vendor: string;
      name: string;
      format: string;
      hash: string;
    }
  | {
      kind: "version";
      organizationId: string;
      vendor: string;
      name: string;
      format: string;
      hash: string;
      version: string;
      contentHash: string;
      env: string;
      schemaType: DataStructureResource["meta"]["schemaType"];
    };

export class SchemasProvider
  implements vscode.TreeDataProvider<string>, vscode.Disposable
{
  private static readonly _schemas: Map<string, DataStructureResource> =
    new Map();

  private static readonly elementCache: Map<string, SchemaProviderElement> =
    new Map();

  private _onDidChangeTreeData = new vscode.EventEmitter<string | void>();
  private _disposable: vscode.Disposable;

  constructor(private readonly provider: AuthenticationProvider) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      "**/*/jsonschema/*-*-*"
    );
    const keyUpdate = (prefix: string) => () =>
      Array.from(SchemasProvider.elementCache.keys())
        .filter((k) => k.startsWith(prefix))
        .forEach((k) => this._onDidChangeTreeData.fire(k));

    watcher.onDidChange(keyUpdate("workspace."));
    watcher.onDidCreate(keyUpdate("workspace."));
    watcher.onDidDelete(keyUpdate("workspace."));

    this._disposable = vscode.Disposable.from(
      vscode.workspace.onDidChangeWorkspaceFolders(() =>
        this._onDidChangeTreeData.fire()
      ),
      this.provider.onDidChangeSessions(() => this._onDidChangeTreeData.fire()),
      watcher
    );
  }

  public dispose() {
    this._disposable.dispose();
  }

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private idForElement(element: SchemaProviderElement): string {
    let id: string;
    switch (element.kind) {
      case "workspace":
        id = [element.kind, element.repoName].join(".");
        break;
      case "static":
        id = [element.kind, element.baseUrl].join(".");
        break;
      case "organization":
        id = [element.kind, element.organizationId].join(".");
        break;
      case "vendor":
        id = [element.kind, element.organizationId, element.vendor].join(".");
        break;
      case "name":
        id = [
          element.kind,
          element.organizationId,
          element.vendor,
          element.name,
        ].join(".");
        break;
      case "format":
        id = [
          element.kind,
          element.organizationId,
          element.vendor,
          element.name,
          element.format,
        ].join(".");
        break;
      case "version":
        id = [
          element.kind,
          element.organizationId,
          element.contentHash || [element.vendor, element.name].join("."),
          element.version,
          element.env,
        ].join(".");
        break;
    }

    if (!SchemasProvider.elementCache.has(id))
      SchemasProvider.elementCache.set(id, element);
    return id;
  }

  getTreeItem(elementId: string): vscode.TreeItem {
    const element = SchemasProvider.elementCache.get(elementId)!;

    const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;
    const buildTI = (props: Partial<vscode.TreeItem>) =>
      Object.assign(
        new vscode.TreeItem("", Expanded),
        { id: this.idForElement(element) },
        props
      );

    switch (element.kind) {
      case "workspace":
        return buildTI({
          label: element.repoName,
        });
      case "static":
        return buildTI({
          label: element.repoName,
          description: element.baseUrl,
        });
      case "organization":
        return buildTI({
          label: element.organization,
          description: element.organizationId,
        });
      case "vendor":
        return buildTI({
          label: element.vendor,
          collapsibleState: Collapsed,
        });
      case "name":
        return buildTI({
          label: element.name,
          collapsibleState: Collapsed,
        });
      case "format":
        return buildTI({
          label: element.format,
        });
      case "version":
        const igluUri = `iglu:${element.vendor}/${element.name}/${element.format}/${element.version}`;
        let command: vscode.Command;

        if (element.env === "LOCAL") {
          command = {
            title: "View Iglu Schema",
            command: "vscode.open",
            arguments: [element.contentHash, { preview: true }, igluUri],
          };
        } else if (element.contentHash) {
          const consoleUri = vscode.Uri.from({
            scheme: TextDocumentContentProvider.scheme,
            authority: element.organizationId,
            path: ["", element.hash, element.format, element.version].join("/"),
            query: element.env ? `?env=${element.env}` : undefined,
          });

          command = {
            title: "View Iglu Schema",
            command: "vscode.open",
            arguments: [consoleUri, { preview: true }, igluUri],
          };
        } else {
          const staticUri = vscode.Uri.from({
            scheme: TextDocumentContentProvider.scheme,
            authority: "",
            path: [
              "",
              element.vendor,
              element.name,
              element.format,
              element.version,
            ].join("/"),
            fragment: element.organizationId,
          });

          command = {
            title: "View Iglu Schema",
            command: "vscode.open",
            arguments: [staticUri, { preview: true }, igluUri],
          };
        }

        return buildTI({
          label: element.version,
          collapsibleState: None,
          description: `${element.schemaType || "schema"} | ${element.env}`,
          command,
        });
    }
  }

  async getChildren(elementId?: string): Promise<string[]> {
    if (!elementId) {
      return (await this.getRootChildren()).map(this.idForElement);
    } else {
      const element = SchemasProvider.elementCache.get(elementId)!;
      return (await this.getNodeChildren(element)).map(this.idForElement);
    }
  }

  private async getRootChildren(): Promise<SchemaProviderElement[]> {
    const igluCentral: SchemaProviderElement = {
      kind: "static",
      repoName: "Iglu Central",
      baseUrl: "http://iglucentral.com/schemas",
      manifest: "",
    };

    const schemaFiles = await vscode.workspace.findFiles(
      "**/*/jsonschema/*-*-*"
    );
    const workspaceFolders = vscode.workspace.workspaceFolders || [
      {
        name: "No Active Folder/Workspace",
        index: 0,
        uri: vscode.Uri.parse("file:/"),
      },
    ];

    const workspaces: SchemaProviderElement[] = workspaceFolders
      .filter((wsf) =>
        schemaFiles.some((sf) => sf.toString().startsWith(wsf.uri.toString()))
      )
      .map((ws) => ({
        kind: "workspace",
        repoName: ws.name,
        uri: ws.uri,
      }));

    const sessions = await this.provider.getSessions();
    if (!sessions.length) {
      const session = await vscode.authentication.getSession(
        AuthenticationProvider.providerId,
        []
      );
      if (session)
        return [
          ...workspaces,
          {
            kind: "organization",
            organizationId: session.id,
            organization: session.account.label,
          },
          igluCentral,
        ];
      else return [...workspaces, igluCentral];
    }

    return workspaces.concat(
      sessions.map(
        ({ id, account: { label } }): SchemaProviderElement => ({
          kind: "organization",
          organizationId: id,
          organization: label,
        })
      ),
      [igluCentral]
    );
  }

  private async getNodeChildren(
    element: SchemaProviderElement
  ): Promise<SchemaProviderElement[]> {
    switch (element.kind) {
      case "workspace":
        return this.getWorkspaceNodeChildren(element);
      case "static":
        return this.getStaticNodeChildren(element);
      case "organization":
        return this.getOrganizationNodeChildren(element);
      case "vendor":
        return this.getVendorNodeChildren(element);
      case "name":
        return this.getNameNodeChildren(element);
      case "format":
        return this.getFormatNodeChildren(element);
      case "version":
        return [];
    }
  }

  private async getWorkspaceNodeChildren(
    element: Extract<SchemaProviderElement, { kind: "workspace" }>
  ): Promise<SchemaProviderElement[]> {
    const schemaFiles = await vscode.workspace.findFiles(
      "**/*/jsonschema/*-*-*"
    );
    const urisForFolder = schemaFiles.filter((sf) =>
      sf.toString().startsWith(element.uri.toString())
    );

    const contents = await Promise.all(
      urisForFolder.map((fsUri) =>
        vscode.workspace.fs.readFile(fsUri).then((bytes) => ({
          fsUri,
          contents: Buffer.from(bytes).toString("utf-8"),
        }))
      )
    );

    const localVendors: Set<string> = new Set();

    contents.forEach(({ fsUri, contents }) => {
      let jsonContents;
      try {
        jsonContents = JSON.parse(contents);
        if (
          typeof jsonContents !== "object" ||
          !jsonContents ||
          !("self" in jsonContents)
        )
          return;
      } catch {
        return;
      }

      const { vendor, name, format, version } = jsonContents["self"];

      const sha256 = createHash("sha256");
      sha256.update([element.repoName, vendor, name].join("-"));
      const hash = sha256.digest("hex");

      const ds: DataStructureResource = {
        organizationId: element.repoName,
        vendor,
        name,
        format,
        hash,
        meta: {},
        deployments: [],
      };

      ds.deployments.push({
        version,
        patchLevel: 1,
        env: "LOCAL",
        contentHash: fsUri.toString(),
      });

      localVendors.add(vendor);
      SchemasProvider._schemas.set(hash, ds);
    });

    return Array.from(localVendors.values())
      .sort()
      .map((vendor) => ({
        kind: "vendor",
        organizationId: element.repoName,
        vendor,
      }));
  }

  private async getStaticNodeChildren(
    element: Extract<SchemaProviderElement, { kind: "static" }>
  ): Promise<SchemaProviderElement[]> {
    const uri = vscode.Uri.joinPath(
      vscode.Uri.parse(element.baseUrl),
      element.manifest
    );
    const manifest: string[] = await fetch(uri.toString()).then((r) =>
      r.ok ? r.json() : Promise.reject(r)
    );

    const manifestVendors = new Set<string>();

    manifest.forEach((igluUri) => {
      const [vendor, name, format, version] = igluUri
        .replace("iglu:", "")
        .split("/");

      const sha256 = createHash("sha256");
      sha256.update([element.baseUrl, vendor, name].join("-"));
      const hash = sha256.digest("hex");

      const ds = SchemasProvider._schemas.get(hash) || {
        organizationId: element.baseUrl,
        vendor,
        name,
        format,
        hash,
        meta: {},
        deployments: [],
      };

      ds.deployments.push({
        version,
        patchLevel: 1,
        env: "PROD",
        contentHash: "",
      });

      manifestVendors.add(vendor);
      SchemasProvider._schemas.set(hash, ds);
    });

    return Array.from(manifestVendors.values())
      .sort()
      .map((vendor) => ({
        kind: "vendor",
        organizationId: element.baseUrl,
        vendor,
      }));
  }

  private async getOrganizationNodeChildren(
    element: Extract<SchemaProviderElement, { kind: "organization" }>
  ): Promise<SchemaProviderElement[]> {
    const schemas: DataStructureResource[] =
      await this.provider.consoleApiRequest(
        "/data-structures/v1",
        element.organizationId
      );

    const vendors = new Set<string>();
    for (const ds of schemas) {
      SchemasProvider._schemas.set(ds.hash, ds);
      vendors.add(ds.vendor);
    }

    return Array.from(vendors.values())
      .sort()
      .map((vendor) => ({
        kind: "vendor",
        organizationId: element.organizationId,
        vendor,
      }));
  }

  private async getVendorNodeChildren(
    element: Extract<SchemaProviderElement, { kind: "vendor" }>
  ): Promise<SchemaProviderElement[]> {
    return Array.from(SchemasProvider._schemas.values())
      .filter(
        (ds) =>
          ds.organizationId === element.organizationId &&
          ds.vendor === element.vendor
      )
      .map((ds) => ({ kind: "name", ...ds }));
  }

  private async getNameNodeChildren(
    element: Extract<SchemaProviderElement, { kind: "name" }>
  ): Promise<SchemaProviderElement[]> {
    return Array.from(SchemasProvider._schemas.values())
      .filter(
        (ds) =>
          ds.organizationId === element.organizationId &&
          ds.vendor === element.vendor &&
          ds.name === element.name
      )
      .map((ds) => ({ kind: "format", ...ds }));
  }

  private async getFormatNodeChildren(
    element: Extract<SchemaProviderElement, { kind: "format" }>
  ): Promise<SchemaProviderElement[]> {
    const ds = SchemasProvider._schemas.get(element.hash);

    return ds
      ? ds.deployments.map(({ env, contentHash, version }) => ({
          kind: "version",
          organizationId: ds.organizationId,
          vendor: ds.vendor,
          name: ds.name,
          format: ds.format,
          hash: ds.hash,
          version,
          env,
          contentHash,
          schemaType: ds.meta.schemaType,
        }))
      : [];
  }
}
