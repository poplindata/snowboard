import * as vscode from "vscode";
import fetch from "isomorphic-fetch";

const AUTH_PROVIDER_ID = "poplin.snowplow.console" as const;
const AUTH_PROVIDER_NAME = "Snowplow Console" as const;
const REGISTRIES_SECRETS_KEY = `${AUTH_PROVIDER_ID}.registries`;

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const CONSOLE_API = "https://console.snowplowanalytics.com/api/msc/v1";

interface OrgCredentials {
  type: typeof AUTH_PROVIDER_NAME;
  organizationId: string;
  apiKey: string;
  organizations: readonly string[];
}

export class AuthenticationProvider
  implements vscode.AuthenticationProvider, vscode.Disposable
{
  static readonly providerId = AUTH_PROVIDER_ID;
  static readonly providerName = AUTH_PROVIDER_NAME;
  private _disposable: vscode.Disposable;
  private _sessionChangeEmitter: vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;
  private _currentSessions: Map<string, vscode.AuthenticationSession>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._sessionChangeEmitter = new vscode.EventEmitter();
    this._currentSessions = new Map();
    this._disposable = vscode.Disposable.from(
      vscode.authentication.registerAuthenticationProvider(
        AuthenticationProvider.providerId,
        AuthenticationProvider.providerName,
        this,
        {
          supportsMultipleAccounts: false,
        }
      ),
      this._sessionChangeEmitter
    );
  }

  dispose() {
    this._disposable.dispose();
  }

  async createSession(): Promise<vscode.AuthenticationSession> {
    const organizationId = await vscode.window.showInputBox({
      title: AUTH_PROVIDER_NAME,
      prompt: "Organization ID",
      ignoreFocusOut: true,
      validateInput: (value) =>
        UUID_PATTERN.test(value) ? "" : "Unexpected Organization ID format",
    });
    if (!organizationId) return Promise.reject();

    const apiKey = await vscode.window.showInputBox({
      title: AUTH_PROVIDER_NAME,
      prompt: "API Key",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        UUID_PATTERN.test(value) ? "" : "Unexpected API Key format",
    });
    if (!apiKey) return Promise.reject();

    const session = await this.authSession(organizationId, apiKey);

    await this.mutateStoredCredentials((existing) =>
      existing.concat([
        {
          type: AUTH_PROVIDER_NAME,
          organizationId: session.id,
          apiKey,
          organizations: session.scopes,
        },
      ])
    );

    this._currentSessions.set(session.id, session);
    this._sessionChangeEmitter.fire({
      added: [session],
      removed: [],
      changed: [],
    });

    return session;
  }

  async getSessions(
    scopes?: readonly string[]
  ): Promise<vscode.AuthenticationSession[]> {
    const stored = await this.mutateStoredCredentials();

    const existing = await Promise.all(
      stored.map(async ({ organizationId, apiKey }) => {
        const current = this._currentSessions.get(organizationId);
        if (current) return current;

        const created = await this.authSession(organizationId, apiKey);
        this._currentSessions.set(created.id, created);

        if (
          scopes &&
          scopes.length &&
          scopes.every((scope) => created.scopes.includes(scope))
        )
          return created;
      })
    );

    return existing.filter((e): e is NonNullable<typeof e> => !!e);
  }

  async removeSession(sessionId: string) {
    const session = this._currentSessions.get(sessionId);
    if (this._currentSessions.delete(sessionId)) {
      await this.mutateStoredCredentials((existing) =>
        existing.filter(({ organizationId }) => organizationId !== sessionId)
      );

      this._sessionChangeEmitter.fire({
        added: [],
        removed: [session!],
        changed: [],
      });
    }
    return Promise.resolve();
  }

  get onDidChangeSessions() {
    return this._sessionChangeEmitter.event;
  }

  private async authSession(
    organizationId: string,
    apiKey: string
  ): Promise<vscode.AuthenticationSession> {
    const accessToken = await this.fetchAccessToken(organizationId, apiKey);
    const organizations: { id: string; name: string }[] =
      await this.consoleApiRequest("/organizations", undefined, accessToken);

    const orgIds = organizations.map((org) => org.id);

    const authenticated = organizations.find(
      (org) => org.id === organizationId
    ) || {
      id: organizationId,
      name: organizationId,
    };

    return {
      id: authenticated.id,
      accessToken,
      scopes: orgIds,
      account: {
        id: authenticated.id,
        label: authenticated.name,
      },
    };
  }

  private async mutateStoredCredentials(
    fn?: (orgs: OrgCredentials[]) => OrgCredentials[]
  ) {
    const existing: OrgCredentials[] = JSON.parse(
      (await this.context.secrets.get(REGISTRIES_SECRETS_KEY)) || "[]"
    );

    const updated = fn ? fn(existing) : existing;

    await this.context.secrets.store(
      REGISTRIES_SECRETS_KEY,
      JSON.stringify(updated)
    );

    return updated;
  }

  public async consoleApiRequest<T>(
    endpoint: string,
    organizationId?: string,
    accessToken?: string
  ): Promise<T> {
    const orgSegment = organizationId ? `/organizations/${organizationId}` : "";
    const epSegment = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const uri = `${CONSOLE_API}${orgSegment}${epSegment}`;

    if (!accessToken && organizationId) {
      const session = this._currentSessions.get(organizationId);
      if (session) accessToken = session.accessToken;
      else return Promise.reject();
    }

    if (!accessToken) return Promise.reject();

    return fetch(uri, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((r) => {
      return r.ok ? r.json() : Promise.reject(r.json());
    });
  }

  private async fetchAccessToken(
    organizationId: string,
    apiKey: string
  ): Promise<string> {
    const { accessToken }: { accessToken: string } = await fetch(
      `${CONSOLE_API}/organizations/${organizationId}/credentials/v2/token`,
      {
        headers: { "X-API-Key": apiKey },
      }
    ).then((r) => r.json());

    return accessToken;
  }
}
