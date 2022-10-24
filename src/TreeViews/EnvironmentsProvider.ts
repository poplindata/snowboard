import * as vscode from "vscode";

import {
  AuthenticationProvider,
  TextDocumentContentProvider,
} from "../SnowplowConsole";

type ConsoleResourceList = {
  minis: {
    id: string;
    cleanEndpoint: string;
    cloudProvider: string;
  }[];
  pipelines: {
    id: string;
    name: string;
    cloudProvider: string;
  }[];
};

type CollectorConfigResource = {
  domains: {
    fallback: string;
    cookieDomains: string[];
    dnsDomains: string[];
    collectorCname: string[];
  };
  paths: {
    post: {
      paths: string[];
    };
    webhook: {
      paths: string[];
    };
    redirect: {
      enabled: boolean;
      paths: string[];
    };
  };
  cookieAttributes: {
    secure: boolean;
    sameSite: string;
    httpOnly: boolean;
  };
  blockUnencrypted: boolean;
};

type EnrichmentConfigResource = {
  id: string;
  filename: string;
  content: Record<string, unknown> | null;
  enabled: boolean;
  lastUpdate: string;
};

type EnvironmentProviderElement =
  | { kind: "organization"; organizationId: string; organization: string }
  | {
      kind: "mini";
      organizationId: string;
      id: string;
      cleanEndpoint: string;
      cloudProvider: string;
    }
  | {
      kind: "pipeline";
      organizationId: string;
      id: string;
      name: string;
      cloudProvider: string;
    }
  | {
      kind: "collector";
      organizationId: string;
      id: string;
      name: string;
      cloudProvider: string;
      config: CollectorConfigResource;
    }
  | {
      kind: "enrichment";
      organizationId: string;
      id: string;
      name: string;
      cloudProvider: string;
      config: EnrichmentConfigResource;
    };

export class EnvironmentsProvider
  implements vscode.TreeDataProvider<EnvironmentProviderElement>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();

  constructor(private readonly provider: AuthenticationProvider) {
    this.provider.onDidChangeSessions(() => this._onDidChangeTreeData.fire());
  }

  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  getTreeItem(element: EnvironmentProviderElement): vscode.TreeItem {
    const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;
    const buildTI = (props: Partial<vscode.TreeItem>) =>
      Object.assign(new vscode.TreeItem("", Collapsed), props);
    switch (element.kind) {
      case "organization":
        return buildTI({
          label: element.organization,
          description: element.organizationId,
          id: [element.organizationId].join("."),
        });
      case "mini":
        const endpointUri = new URL(element.cleanEndpoint);
        return buildTI({
          label: endpointUri.hostname,
          description: `${element.kind} | ${element.cloudProvider}`,
          id: [element.organizationId, element.id].join("."),
        });
      case "pipeline":
        return buildTI({
          label: element.name,
          description: `${element.kind} | ${element.cloudProvider}`,
          id: [element.organizationId, element.id].join("."),
        });
      case "collector":
        return buildTI({
          label: element.kind,
          collapsibleState: None,
          id: [element.organizationId, element.id, "collector"].join("."),
          command: {
            title: "View Collector Configuration",
            command: "vscode.open",
            arguments: [
              vscode.Uri.from({
                scheme: TextDocumentContentProvider.scheme,
                fragment: JSON.stringify(element.config),
              }),
              { preview: true },
              element.kind,
            ],
          },
        });
      case "enrichment":
        const { id, content, enabled, filename } = element.config;
        let name = "";
        if (content) {
          if (content.vendor) name += content.vendor + " / ";
          if (content.name) name += content.name;
        }
        if (!name) name = filename;

        return buildTI({
          label: name,
          description: enabled ? undefined : "disabled",
          collapsibleState: None,
          id: [element.organizationId, element.id, "enrichment", id].join("."),
          command: {
            title: "View Enrichment Configuration",
            command: "vscode.open",
            arguments: [
              vscode.Uri.from({
                scheme: TextDocumentContentProvider.scheme,
                fragment: JSON.stringify(element.config),
              }),
              { preview: true },
              filename,
            ],
          },
        });
    }
  }

  async getChildren(
    element?: EnvironmentProviderElement
  ): Promise<EnvironmentProviderElement[]> {
    if (!element) {
      return this.getRootChildren();
    } else {
      return this.getNodeChildren(element);
    }
  }

  private async getRootChildren(): Promise<EnvironmentProviderElement[]> {
    const sessions = await this.provider.getSessions();
    if (!sessions.length) {
      const session = await vscode.authentication.getSession(
        AuthenticationProvider.providerId,
        []
      );
      if (session) {
        const {
          id,
          account: { label },
        } = session;

        return [
          { kind: "organization", organizationId: id, organization: label },
        ];
      } else return [];
    }

    return sessions.map(
      ({ id, account: { label } }): EnvironmentProviderElement => ({
        kind: "organization",
        organizationId: id,
        organization: label,
      })
    );
  }

  private async getNodeChildren(
    element: EnvironmentProviderElement
  ): Promise<EnvironmentProviderElement[]> {
    switch (element.kind) {
      case "organization":
        return this.getOrganizationNodeChildren(element);
      case "mini":
        return this.getMiniNodeChildren(element);
      case "pipeline":
        return this.getPipelineNodeChildren(element);
      default:
        return [];
    }
  }

  private async getOrganizationNodeChildren(
    element: Extract<EnvironmentProviderElement, { kind: "organization" }>
  ): Promise<EnvironmentProviderElement[]> {
    const resources: ConsoleResourceList =
      await this.provider.consoleApiRequest(
        "/resources/v1",
        element.organizationId
      );

    return ([] as EnvironmentProviderElement[]).concat(
      resources.minis.map(
        (mini): EnvironmentProviderElement =>
          Object.assign(
            { kind: "mini", organizationId: element.organizationId } as const,
            mini
          )
      ),
      resources.pipelines.map(
        (pipeline): EnvironmentProviderElement =>
          Object.assign(
            {
              kind: "pipeline",
              organizationId: element.organizationId,
            } as const,
            pipeline
          )
      )
    );
  }

  private configFromEndpointURI(endpoint: URL): CollectorConfigResource {
    return {
      domains: {
        fallback: endpoint.hostname,
        cookieDomains: [endpoint.hostname],
        dnsDomains: [endpoint.hostname],
        collectorCname: [],
      },
      paths: {
        post: {
          paths: [],
        },
        webhook: {
          paths: [],
        },
        redirect: {
          enabled: false,
          paths: [],
        },
      },
      cookieAttributes: {
        secure: false,
        sameSite: "Lax",
        httpOnly: false,
      },
      blockUnencrypted: false,
    };
  }

  private async getMiniNodeChildren(
    element: Extract<EnvironmentProviderElement, { kind: "mini" }>
  ): Promise<EnvironmentProviderElement[]> {
    const endpointUrl = new URL(element.cleanEndpoint);
    const collector = this.configFromEndpointURI(endpointUrl);

    const baseConfigEndpoint = `/resources/v1/minis/${element.id}/configuration`;

    const enrichments = await this.provider.consoleApiRequest<
      EnrichmentConfigResource[]
    >(`${baseConfigEndpoint}/enrichments`, element.organizationId);

    return [
      {
        ...element,
        name: endpointUrl.hostname,
        kind: "collector",
        config: collector,
      },
      ...enrichments.map(
        (en): EnvironmentProviderElement => ({
          ...element,
          name: endpointUrl.hostname,
          kind: "enrichment",
          config: en,
        })
      ),
    ];
  }

  private async getPipelineNodeChildren(
    element: Extract<EnvironmentProviderElement, { kind: "pipeline" }>
  ): Promise<EnvironmentProviderElement[]> {
    const baseConfigEndpoint = `/resources/v1/pipelines/${element.id}/configuration`;

    const [collector, enrichments] = await Promise.allSettled([
      this.provider.consoleApiRequest<CollectorConfigResource>(
        `${baseConfigEndpoint}/collector`,
        element.organizationId
      ),
      this.provider.consoleApiRequest<EnrichmentConfigResource[]>(
        `${baseConfigEndpoint}/enrichments`,
        element.organizationId
      ),
    ]);

    if (collector.status === "rejected" || enrichments.status === "rejected")
      return [];

    return [
      { ...element, kind: "collector", config: collector.value },
      ...enrichments.value.map(
        (en): EnvironmentProviderElement => ({
          ...element,
          kind: "enrichment",
          config: en,
        })
      ),
    ];
  }
}
