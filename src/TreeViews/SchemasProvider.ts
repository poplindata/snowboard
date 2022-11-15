import * as vscode from "vscode";

import { TextDocumentContentProvider } from "../SnowplowConsole";

import {
  SchemaService,
  RegistryDescriptor,
  SchemaDescriptor,
  Selector,
} from "../SchemaService";

type SchemaProviderElement =
  | RegistryDescriptor
  | { kind: "vendor"; registry: RegistryDescriptor; vendor: string }
  | { kind: "name"; registry: RegistryDescriptor; vendor: string; name: string }
  | {
      kind: "format";
      registry: RegistryDescriptor;
      vendor: string;
      name: string;
      format: string;
    }
  | ({ kind: "version" } & SchemaDescriptor);

export class SchemasDragAndDropController
  implements vscode.TreeDragAndDropController<string>
{
  dropMimeTypes: readonly string[] = [];
  dragMimeTypes: readonly string[] = [
    "application/schema+json",
    "application/json",
    "text/uri-list",
  ];

  constructor(private readonly provider: SchemasProvider) {}

  handleDrag(
    source: readonly string[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): void {
    const schemaUris = source.map(
      (s) => this.provider.getTreeItem(s).resourceUri
    );
    const uriList = schemaUris
      .filter(Boolean)
      .map((uri) => uri!.toString())
      .join("\n");
    dataTransfer.set("text/uri-list", new vscode.DataTransferItem(uriList));
  }
}

export class SchemasProvider implements vscode.TreeDataProvider<string> {
  private static readonly elementCache: Map<string, SchemaProviderElement> =
    new Map();

  private _onDidChangeTreeData = new vscode.EventEmitter<string | void>();

  constructor(private readonly schemaService: SchemaService) {}

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  public static getElementById(key: string): SchemaProviderElement | undefined {
    return SchemasProvider.elementCache.get(key);
  }

  private idForElement(element: SchemaProviderElement): string {
    let id: string;
    switch (element.kind) {
      case "workspace":
      case "static":
      case "organization":
        id = [element.kind, element.id].join(".");
        break;
      case "vendor":
        id = [element.kind, element.registry.id, element.vendor].join(".");
        break;
      case "name":
        id = [
          element.kind,
          element.registry.id,
          element.vendor,
          element.name,
        ].join(".");
        break;
      case "format":
        id = [
          element.kind,
          element.registry.id,
          element.vendor,
          element.name,
          element.format,
        ].join(".");
        break;
      case "version":
        id = [
          element.kind,
          element.registry.id,
          element.igluUri.hash(element.registry.id),
          element.igluUri.version,
          element.env,
        ].join(".");
        break;
    }

    if (!SchemasProvider.elementCache.has(id))
      SchemasProvider.elementCache.set(id, element);
    return id;
  }

  getTreeItem(elementId: string): vscode.TreeItem {
    const element = SchemasProvider.getElementById(elementId)!;

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
          label: element.name,
        });
      case "static":
        return buildTI({
          label: element.name,
          description: element.baseUrl,
        });
      case "organization":
        return buildTI({
          label: element.name,
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
        const { env, igluUri, schemaType, uri } = element;

        return buildTI({
          label: igluUri.version,
          collapsibleState: None,
          description: `${schemaType || "schema"} | ${env}`,
          tooltip: igluUri.toString(),
          resourceUri: uri,
          command: {
            title: "View Iglu Schema",
            command: "vscode.open",
            arguments: [uri, { preview: true }, igluUri.toString()],
          },
        });
    }
  }

  async getChildren(elementId?: string): Promise<string[]> {
    if (!elementId) {
      return (await this.getRootChildren()).map(this.idForElement);
    } else {
      const element = SchemasProvider.getElementById(elementId)!;
      return (await this.getNodeChildren(element)).map(this.idForElement);
    }
  }

  private async getRootChildren(): Promise<readonly SchemaProviderElement[]> {
    const registries = this.schemaService.registries();
    if (registries.length) {
      return registries;
    } else {
      await this.schemaService.findRegistries();
      return this.schemaService.registries();
    }
  }

  private async getNodeChildren(
    element: SchemaProviderElement
  ): Promise<SchemaProviderElement[]> {
    switch (element.kind) {
      case "workspace":
        await this.schemaService.findLocalSchemas();
        return this.getUniqueNextChildren(element);
      case "organization":
        await this.schemaService.findConsoleSchemas();
        return this.getUniqueNextChildren(element);
      case "static":
        await this.schemaService.findStaticSchemas();
        return this.getUniqueNextChildren(element);
      case "vendor":
      case "name":
        return this.getUniqueNextChildren(element);
      case "format":
        return this.getFormatNodeChildren(element);
      case "version":
        return [];
    }
  }

  private async getUniqueNextChildren(
    element: Exclude<SchemaProviderElement, { kind: "version" | "format" }>
  ): Promise<
    Exclude<SchemaProviderElement, RegistryDescriptor | { kind: "version" }>[]
  > {
    const nextKind = (
      {
        organization: "vendor",
        static: "vendor",
        workspace: "vendor",
        vendor: "name",
        name: "format",
      } as const
    )[element.kind];

    const registry = "registry" in element ? element.registry : element;

    const selector: Selector = {
      registry: { kind: registry.kind, id: registry.id },
    };

    if (element.kind === "vendor") {
      selector["igluUri"] = {
        vendor: element.vendor,
      };
    } else if (element.kind === "name") {
      selector["igluUri"] = {
        vendor: element.vendor,
        name: element.name,
      };
    }

    const uniques: Set<string> = new Set();
    this.schemaService.querySchemas(
      (acc, schema) => {
        acc.add(schema.igluUri[nextKind]);
        return acc;
      },
      uniques,
      selector
    );

    return Array.from(uniques.values())
      .sort()
      .map((unique) => {
        if (nextKind === "name" && element.kind === "vendor") {
          return {
            kind: nextKind,
            registry,
            vendor: element.vendor,
            name: unique,
          };
        } else if (nextKind === "format" && element.kind === "name") {
          return {
            kind: nextKind,
            registry,
            vendor: element.vendor,
            name: element.name,
            format: unique,
          };
        } else if (nextKind === "vendor") {
          return { kind: nextKind, registry, vendor: unique };
        } else return "unreachable" as never;
      });
  }

  private async getFormatNodeChildren(
    element: Extract<SchemaProviderElement, { kind: "format" }>
  ): Promise<SchemaProviderElement[]> {
    const schemas = this.schemaService.getSchemas({
      registry: {
        kind: element.registry.kind,
        id: element.registry.id,
      },
      igluUri: {
        vendor: element.vendor,
        name: element.name,
        format: element.format,
      },
    });

    return schemas.map((schema) => ({
      kind: "version",
      ...schema,
    }));
  }
}
