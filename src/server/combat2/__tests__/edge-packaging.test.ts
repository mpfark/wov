import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const FUNCTIONS = resolve(ROOT, "supabase/functions");
const COMBAT2_SRC = resolve(ROOT, "src/shared/combat2");
const COMBAT2_DST = resolve(FUNCTIONS, "_shared/combat2");
const WORKER_SRC = resolve(ROOT, "src/server/combat2/process-node-tick-once.ts");
const INVENTORY_SRC = resolve(ROOT, "src/shared/combat/inventory/active-abilities.json");
const ENTRY = resolve(FUNCTIONS, "combat2-tick-once/index.ts");

function walkTs(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (entry === "__tests__") return [];
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walkTs(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function toDeno(source: string): string {
  return source.replace(/(from\s+')([.][^']*?)(')/g, (whole, before, specifier, after) =>
    specifier.endsWith(".ts") || specifier.endsWith(".json")
      ? whole
      : `${before}${specifier}.ts${after}`,
  );
}

function importSpecifiers(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

describe("combat2 Edge packaging", () => {
  it("keeps the generated Combat2 graph and ability catalogue at exact parity", () => {
    for (const source of walkTs(COMBAT2_SRC)) {
      const destination = resolve(COMBAT2_DST, relative(COMBAT2_SRC, source));
      expect(readFileSync(destination, "utf8"), relative(ROOT, destination))
        .toBe(toDeno(readFileSync(source, "utf8")));
    }

    const workerMirror = resolve(COMBAT2_DST, "process-node-tick-once.ts");
    const expectedWorker = toDeno(readFileSync(WORKER_SRC, "utf8")).replaceAll("../../shared/combat2/", "./");
    expect(readFileSync(workerMirror, "utf8")).toBe(expectedWorker);
    expect(readFileSync(resolve(COMBAT2_DST, "active-abilities.json")))
      .toEqual(readFileSync(INVENTORY_SRC));
  });

  it("keeps every transitive local Edge dependency inside supabase/functions", () => {
    const pending = [ENTRY];
    const visited = new Set<string>();

    while (pending.length > 0) {
      const current = resolve(pending.pop()!);
      if (visited.has(current)) continue;
      visited.add(current);

      expect(current === FUNCTIONS || current.startsWith(`${FUNCTIONS}${sep}`), relative(ROOT, current)).toBe(true);
      expect(current.split(/[\\/]/)).not.toContain("node_modules");
      expect(existsSync(current), relative(ROOT, current)).toBe(true);
      if (!current.endsWith(".ts")) continue;

      for (const specifier of importSpecifiers(current)) {
        expect(specifier.startsWith("file:"), `${relative(ROOT, current)} imports ${specifier}`).toBe(false);
        expect(isAbsolute(specifier), `${relative(ROOT, current)} imports ${specifier}`).toBe(false);
        if (!specifier.startsWith(".")) continue;
        const dependency = resolve(dirname(current), specifier);
        expect(dependency === FUNCTIONS || dependency.startsWith(`${FUNCTIONS}${sep}`), specifier).toBe(true);
        expect(existsSync(dependency), `${relative(ROOT, current)} imports missing ${specifier}`).toBe(true);
        pending.push(dependency);
      }
    }

    expect(visited).toContain(resolve(COMBAT2_DST, "active-abilities.json"));
    expect([...visited].some((path) => path.includes(`${sep}src${sep}`))).toBe(false);
  });
});
