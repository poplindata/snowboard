import * as vscode from "vscode";

import { resolve } from "path";
import { readFileSync } from "fs";

type VSExtensionPackage = {
  contributes?: {
    snippets?: {
      path: string;
      language?: string;
    }[];
  };
};

type SnippetDefinition = Record<
  string,
  {
    scope?: string;
    description?: string;
    prefix: string;
    body: string[];
  }
>;

type NamedSnippet = SnippetDefinition[string] & { name: string };

export class SnippetService {
  private byLang: Map<string, NamedSnippet[]>;

  constructor(extPath: string, packageJSON: VSExtensionPackage) {
    const snippets = packageJSON.contributes?.snippets ?? [];

    this.byLang = new Map();

    snippets.forEach((snippet) => {
      const fullPath = resolve(extPath, snippet.path);

      try {
        const definitions: SnippetDefinition = JSON.parse(
          readFileSync(fullPath, { encoding: "utf-8" })
        );

        Object.entries(definitions).forEach(([name, definition]) => {
          const langs = definition.scope || snippet.language || "";

          langs.split(",").forEach((lang) => {
            const langDefs = this.byLang.get(lang) || [];
            this.byLang.set(lang, langDefs);
            langDefs.push({ name, ...definition });
          });
        });
      } catch {}
    });
  }

  public getSnippets(lang?: string, name?: string) {
    const langDefs = lang
      ? this.byLang.get(lang) || []
      : Array.from(this.byLang.values()).flat();
    const results = name
      ? langDefs.filter((def) => def.name === name)
      : langDefs;

    return results.length ? results : undefined;
  }

  public evaluate(
    snippet: NamedSnippet,
    vars?: Record<string, any>
  ): vscode.SnippetString {
    let body = snippet.body.join("\n") + "\n";

    for (const [needle, sub] of Object.entries(vars || {})) {
      const placeholder = `:${needle}}`;
      const replacement = `:${sub}}`;
      body = body.replaceAll(placeholder, replacement);
    }

    const result = new vscode.SnippetString(body);
    return result;
  }
}
