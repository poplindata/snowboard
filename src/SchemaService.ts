import { createHash } from "crypto";

import * as vscode from "vscode";

import { AuthenticationProvider } from "./SnowplowConsole";

type IgluSchema = {
  $schema?: "http://iglucentral.com/schemas/com.snowplowanalytics.self-desc/schema/jsonschema/1-0-0#";
  self: {
    vendor: string;
    name: string;
    format: string;
    version: string;
  };
  [key: string]: unknown;
};

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

type WorkspaceDescriptor = {
  kind: "workspace";
  id: string;
  name: string;
  uri: vscode.Uri;
};
type StaticDescriptor = {
  kind: "static";
  id: string;
  name: string;
  baseUrl: string;
  manifest: string;
};
type ConsoleDescriptor = {
  kind: "organization";
  id: string;
  name: string;
  organizationId: string;
};

export type RegistryDescriptor =
  | WorkspaceDescriptor
  | StaticDescriptor
  | ConsoleDescriptor;

export type SchemaDescriptor = {
  schema?: IgluSchema;
  igluUri: IgluUri;
  registry: RegistryDescriptor;
  hash: string;
  uri: vscode.Uri;
  env: "LOCAL" | "DEV" | "PROD";
  schemaType?: "event" | "entity";
};

type SelectorProp =
  | ((_: unknown) => boolean)
  | string
  | boolean
  | number
  | null
  | Selector;
export interface Selector extends Record<string, SelectorProp> {}

const igluCentral = {
  kind: "static",
  id: "http://iglucentral.com/schemas",
  name: "Iglu Central",
  baseUrl: "http://iglucentral.com/schemas",
  manifest: "",
} as const;

class IgluUri {
  constructor(
    public readonly vendor: string,
    public readonly name: string,
    public readonly format: string,
    public readonly version: string
  ) {}

  public static parse(uri: string) {
    const [schema, path, ...rest] = uri.split(":");

    if (schema !== "iglu" || rest.length)
      throw new Error("Invalid Iglu URI", {
        cause: { uri, schema, path, rest },
      });

    const parts = path.split("/");

    if (parts.length !== 4)
      throw new Error("Invalid path in Iglu URI", {
        cause: { uri, path, parts },
      });

    const [vendor, name, format, version] = parts;

    return new IgluUri(vendor, name, format, version);
  }

  public static from({
    vendor,
    name,
    format = "jsonschema",
    version = "1-0-0",
  }: {
    vendor: string;
    name: string;
    format?: string;
    version?: string;
  }) {
    return new IgluUri(vendor, name, format, version);
  }

  public toString(): string {
    return `iglu:${this.vendor}/${this.name}/${this.format}/${this.version}`;
  }

  public hash(registry: string): string {
    const sha256 = createHash("sha256");
    sha256.update([registry, this.vendor, this.name, this.format].join("-"));
    const hash = sha256.digest("hex");
    return hash;
  }
}

export class SchemaService implements vscode.Disposable {
  private _dispose: vscode.Disposable[];

  private staticRegistries: StaticDescriptor[];
  private consoleRegistries: ConsoleDescriptor[];
  private workspaceRegistries: WorkspaceDescriptor[];

  private staticSchemas: SchemaDescriptor[];
  private consoleSchemas: SchemaDescriptor[];
  private workspaceSchemas: SchemaDescriptor[];

  private markRegistriesDiscovered?: () => void;
  private markSchemasDiscovered?: () => void;

  public discovered: Promise<void>;

  constructor(
    private readonly provider: AuthenticationProvider,
    public readonly uriNamespace: string
  ) {
    this.staticRegistries = [];
    this.consoleRegistries = [];
    this.workspaceRegistries = [];

    this.staticSchemas = [];
    this.consoleSchemas = [];
    this.workspaceSchemas = [];

    this._dispose = [];

    this.discovered = Promise.all([
      new Promise<void>((r) => (this.markRegistriesDiscovered = r)),
      new Promise<void>((r) => (this.markSchemasDiscovered = r)),
    ]).then();
  }

  public dispose(): void {
    vscode.Disposable.from(...this._dispose).dispose();
  }

  public registries(): readonly RegistryDescriptor[] {
    return ([] as RegistryDescriptor[]).concat(
      this.workspaceRegistries,
      this.consoleRegistries,
      this.staticRegistries
    );
  }

  public watchForRegistryChanges(): void {
    const watcher = vscode.workspace.createFileSystemWatcher(
      "**/*/jsonschema/*-*-*"
    );

    const handler = () => this.findLocalSchemas();

    this._dispose.push(
      watcher.onDidChange(handler),
      watcher.onDidCreate(handler),
      watcher.onDidDelete(handler),
      watcher,
      vscode.workspace.onDidChangeWorkspaceFolders(() =>
        this.findLocalRegistries()
      ),
      this.provider.onDidChangeSessions(() => {
        this.findConsoleRegistries();
        this.findConsoleSchemas();
      })
    );
  }

  public async discover(): Promise<void> {
    let ready = false;

    return Promise.race([
      this.discovered.then(() => {
        ready = true;
      }),
      new Promise<void>((resolve, reject) =>
        setTimeout(
          () =>
            ready
              ? reject()
              : resolve(this.findRegistries().then(() => this.findSchemas())),
          1000
        )
      ),
    ]);
  }

  public async findRegistries(): Promise<void> {
    return Promise.all([
      this.findConsoleRegistries(),
      this.findLocalRegistries(),
      this.findStaticRegistries(),
    ]).then(() => this.markRegistriesDiscovered!());
  }

  public async findSchemas(): Promise<void> {
    return Promise.all([
      this.findConsoleSchemas(),
      this.findLocalSchemas(),
      this.findStaticSchemas(),
    ]).then(() => this.markSchemasDiscovered!());
  }

  public async findStaticRegistries(): Promise<void> {
    this.staticRegistries = [igluCentral];
  }

  public async findConsoleRegistries(): Promise<void> {
    const sessions = await this.provider.getSessions();
    this.consoleRegistries = sessions.map(({ id, account: { label } }) => ({
      kind: "organization",
      id,
      name: label,
      organizationId: id,
    }));
    if (!this.consoleRegistries.length) {
      const session = await vscode.authentication.getSession(
        AuthenticationProvider.providerId,
        []
      );
      if (session)
        this.consoleRegistries = [
          {
            kind: "organization",
            id: session.id,
            organizationId: session.id,
            name: session.account.label,
          },
        ];
    }
  }

  public async findLocalRegistries(): Promise<void> {
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

    this.workspaceRegistries = workspaceFolders
      .filter((wsf) =>
        schemaFiles.some((sf) => sf.toString().startsWith(wsf.uri.toString()))
      )
      .map((ws) => ({
        kind: "workspace",
        id: ws.name,
        name: ws.name,
        uri: ws.uri,
      }));
  }

  private isSchema(data: unknown): data is IgluSchema {
    if (typeof data === "object" && data && "self" in data) {
      const hasSelf = data as Record<"self", unknown>;
      if (typeof hasSelf["self"] === "object" && hasSelf["self"]) {
        const self = hasSelf["self"] as Record<string, unknown>;

        if (typeof self["vendor"] !== "string") return false;
        if (typeof self["name"] !== "string") return false;
        if (typeof self["format"] !== "string") return false;
        if (typeof self["version"] !== "string") return false;
        return true;
      }
    }
    return false;
  }

  public async findLocalSchemas(): Promise<void> {
    const schemaFiles = await vscode.workspace.findFiles(
      "**/*/jsonschema/*-*-*"
    );

    const fileContents = new Map<vscode.Uri, Thenable<string>>();

    const filesByWorkspace = this.workspaceRegistries.map((ws) =>
      schemaFiles.filter((sf) => sf.toString().startsWith(ws.uri.toString()))
    );

    filesByWorkspace.flat().forEach((uri) => {
      if (!fileContents.has(uri)) {
        fileContents.set(
          uri,
          vscode.workspace.fs
            .readFile(uri)
            .then((bytes) => Buffer.from(bytes).toString("utf-8"))
        );
      }
    });

    const schemasByWorkspace = await Promise.all(
      filesByWorkspace.map(async (uris) =>
        Promise.allSettled(
          uris.map(async (uri) => {
            const buffer = fileContents.get(uri);
            if (!buffer)
              throw new Error("No file found for URI", { cause: { uri } });
            const json = JSON.parse(await buffer);
            if (this.isSchema(json)) return json;
            throw new Error("File is JSON but doesn't appear to be a schema", {
              cause: { uri },
            });
          })
        )
      )
    );

    this.workspaceSchemas = schemasByWorkspace.flatMap((schemaResults, i) =>
      schemaResults.flatMap((result, j): SchemaDescriptor[] => {
        if (result.status === "rejected") return [];

        const registry = this.workspaceRegistries[i];

        const schema = result.value;
        const igluUri = IgluUri.from(schema["self"]);

        return [
          {
            igluUri,
            registry,
            schema,
            hash: igluUri.hash(registry.id),
            uri: filesByWorkspace[i][j],
            env: "LOCAL",
          },
        ];
      })
    );
  }

  public async findConsoleSchemas(): Promise<void> {
    this.consoleSchemas = (
      await Promise.allSettled(
        this.consoleRegistries.map(async (registry) => {
          const schemas: DataStructureResource[] =
            await this.provider.consoleApiRequest(
              "/data-structures/v1",
              registry.organizationId
            );

          return schemas.flatMap((ds) =>
            ds.deployments.flatMap((dep) => {
              const igluUri = IgluUri.from({ ...ds, ...dep });

              console.assert(
                ds.hash === igluUri.hash(registry.organizationId),
                "Schema hash mismatch",
                ds.hash,
                igluUri.hash(registry.organizationId),
                ds,
                igluUri
              );

              const consoleUri = vscode.Uri.from({
                scheme: this.uriNamespace,
                authority: registry.organizationId,
                path: [
                  "",
                  igluUri.hash(registry.organizationId),
                  igluUri.format,
                  igluUri.version,
                ].join("/"),
                query: dep.env ? `?env=${dep.env}` : undefined,
              });

              return {
                igluUri,
                registry,
                hash: igluUri.hash(registry.id),
                env: dep.env as "DEV" | "PROD",
                uri: consoleUri,
                schemaType: ds.meta.schemaType,
              };
            })
          );
        })
      )
    ).flatMap((result) => (result.status === "rejected" ? [] : result.value));
  }

  public async findStaticSchemas(): Promise<void> {
    this.staticSchemas = (
      await Promise.allSettled(
        this.staticRegistries.map(async (registry) => {
          const baseUrl = vscode.Uri.parse(registry.baseUrl);
          const manifestUri = vscode.Uri.joinPath(baseUrl, registry.manifest);

          const manifest: string[] = await fetch(manifestUri.toString()).then(
            (r) => (r.ok ? r.json() : Promise.reject(r))
          );

          return manifest.map((uri) => {
            const igluUri = IgluUri.parse(uri);
            const staticUri = vscode.Uri.joinPath(
              baseUrl.with({ scheme: this.uriNamespace }),
              igluUri.vendor,
              igluUri.name,
              igluUri.format,
              igluUri.version
            );

            return {
              igluUri,
              registry,
              hash: igluUri.hash(registry.id),
              env: "PROD" as const,
              uri: staticUri,
            };
          });
        })
      )
    ).flatMap((result) => (result.status === "rejected" ? [] : result.value));
  }

  private matchSelector(schema: SchemaDescriptor, selector: Selector): boolean {
    return this.innerMatch(true, schema, selector);
  }

  private innerMatch(
    matching: boolean,
    subject: Record<string, unknown>,
    selector: Selector
  ): boolean {
    for (const p in selector) {
      const candidate = selector[p];
      if (p in subject || typeof candidate === "function") {
        const inner = subject[p];
        if (typeof candidate === "function") {
          matching = matching && candidate(inner);
        } else if (candidate === null) {
          matching = matching && inner === null;
        } else if (p === "igluUri" && typeof candidate === "string") {
          matching = matching && candidate === "" + inner;
        } else if (
          typeof candidate === "object" &&
          typeof inner === "object" &&
          inner
        ) {
          matching =
            matching &&
            this.innerMatch(
              matching,
              inner as Record<string, unknown>,
              candidate
            );
        } else {
          matching = matching && inner === candidate;
        }
      } else return false;
    }

    return matching;
  }

  public getSchemas(selector?: Selector): SchemaDescriptor[] {
    if (selector) {
      const filter = (s: SchemaDescriptor) => this.matchSelector(s, selector);
      return [
        ...this.workspaceSchemas.filter(filter),
        ...this.consoleSchemas.filter(filter),
        ...this.staticSchemas.filter(filter),
      ];
    } else
      return [
        ...this.workspaceSchemas,
        ...this.consoleSchemas,
        ...this.staticSchemas,
      ];
  }

  public querySchemas<T>(
    query: (previousResult: T, schema: SchemaDescriptor) => T,
    initial: T,
    selector?: Selector
  ): T {
    if (selector) {
      const filter = (s: SchemaDescriptor) => this.matchSelector(s, selector);
      initial = this.workspaceSchemas.filter(filter).reduce(query, initial);
      initial = this.consoleSchemas.filter(filter).reduce(query, initial);
      initial = this.staticSchemas.filter(filter).reduce(query, initial);
    } else {
      initial = this.workspaceSchemas.reduce(query, initial);
      initial = this.consoleSchemas.reduce(query, initial);
      initial = this.staticSchemas.reduce(query, initial);
    }

    return initial;
  }

  public async fetchSchema(descriptor: SchemaDescriptor): Promise<IgluSchema> {
    if (descriptor.schema) return descriptor.schema;

    let result: IgluSchema | undefined = undefined;

    switch (descriptor.registry.kind) {
      case "organization":
        const [_, schemaHash, format, version] = descriptor.uri.path.split("/");
        const env = descriptor.uri.query || "";

        const schema = await this.provider.consoleApiRequest(
          `/data-structures/v1/${schemaHash}/versions/${version}${env}`,
          descriptor.registry.organizationId
        );

        if (this.isSchema(schema)) result = schema;
        break;
      case "static":
        const urls = [
          descriptor.uri.with({ scheme: "http" }),
          descriptor.uri.with({ scheme: "https" }),
        ];
        result = await Promise.any(
          urls.map((url) =>
            fetch(url.toString())
              .then((resp) =>
                resp.ok
                  ? resp.json()
                  : Promise.reject(
                      new Error("bad response", { cause: { resp } })
                    )
              )
              .then((maybe) =>
                this.isSchema(maybe)
                  ? maybe
                  : Promise.reject(
                      new Error("invalid schema", { cause: { payload: maybe } })
                    )
              )
          )
        );
        break;
      case "workspace":
        result = await vscode.workspace.fs
          .readFile(descriptor.uri)
          .then((bytes) => JSON.parse(Buffer.from(bytes).toString("utf-8")))
          .then((maybe) =>
            this.isSchema(maybe)
              ? maybe
              : Promise.reject(
                  new Error("invalid schema file", {
                    cause: { uri: descriptor.uri },
                  })
                )
          );
    }

    if (result) {
      descriptor.schema = result;
      return result;
    } else {
      throw new Error("could not fetch schema", { cause: descriptor });
    }
  }

  public async resolve(
    request: SchemaDescriptor | IgluUri | string | Selector
  ): Promise<IgluSchema> {
    if (typeof request === "string") request = IgluUri.parse(request);
    if (request instanceof IgluUri) request = { igluUri: request.toString() };

    return Promise.any(
      this.getSchemas(request as Selector).map((desc) => this.fetchSchema(desc))
    );
  }
}
