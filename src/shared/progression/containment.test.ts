/** Prevent the 001A reference/fixture layer becoming a current gameplay dependency. */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const referenceRoot = path.resolve(root, 'src/shared/progression');
const filesUnder = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? filesUnder(path.join(directory, entry.name))
    : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path.join(directory, entry.name)] : []);
const resolveSpecifier = (file: string, specifier: string) =>
  specifier.startsWith('@/') ? path.resolve(root, 'src', specifier.slice(2))
    : specifier.startsWith('@shared/') ? path.resolve(root, 'supabase/functions/_shared', specifier.slice(8))
      : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : '';

describe('001A runtime containment', () => {
  it('has no current source/Edge importer or re-export of progression contracts/reference/fixtures', () => {
    const offenders: string[] = [];
    for (const file of [...filesUnder(path.join(root, 'src')), ...filesUnder(path.join(root, 'supabase/functions'))]) {
      if (file.startsWith(referenceRoot + path.sep) || /\.(test|spec)\.[jt]sx?$/.test(file)) continue;
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
          : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
            || ts.isIdentifier(node.expression) && node.expression.text === 'require') ? node.arguments[0] : undefined;
        if (specifier && ts.isStringLiteralLike(specifier)) {
          const resolved = resolveSpecifier(file, specifier.text);
          if (resolved === referenceRoot || resolved.startsWith(referenceRoot + path.sep)) offenders.push(path.relative(root, file));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
  });
  it('keeps the calculation layer free of IO and imports only existing pure math/local contracts', () => {
    for (const file of ['reference.ts', 'resource-reference.ts', 'contract.ts', 'golden-vectors.ts']) {
      const text = readFileSync(path.join(referenceRoot, file), 'utf8');
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const imports = source.statements.filter(ts.isImportDeclaration).map(statement => (statement.moduleSpecifier as ts.StringLiteral).text);
      expect(imports.every(value => ['./contract', './resource-reference', '../formulas/xp'].includes(value))).toBe(true);
      expect(text).not.toMatch(/\b(?:fetch|setTimeout|setInterval)\s*\(|\bMath\.random\s*\(|\bDate\.now\s*\(/);
    }
  });
});
