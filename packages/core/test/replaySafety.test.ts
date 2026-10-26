import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { comment } from '../src/export/replay.js';

const source = readFileSync(new URL('../src/export/replay.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('replay.ts', source, ts.ScriptTarget.Latest, true);

/** Calls whose arguments may hold anything: they make a string literal or a one-line comment. */
const QUOTING = new Set(['q', 'comment', 'JSON.stringify']);
/** Calls that return generated code built only from checked pieces, or a number. */
const CODE_CALLS = new Set(['locatorFor', 'Math.min', 'Math.max', 'String']);
/** Locals that hold generated code built from checked pieces (`scope`, `el`, body lines `l`) or a number. */
const CODE_NAMES = new Set(['scope', 'root', 's', 'el', 'v', 'l', 'source', 'timeout', 'total']);
const NUMBERS = new Set(['step.number', 's.number']);

const callee = (n: ts.CallExpression) => n.expression.getText(file);

function inside(n: ts.Node, test: (p: ts.Node) => boolean): boolean {
  for (let p = n.parent; p; p = p.parent) if (test(p)) return true;
  return false;
}

/** Why an interpolated expression is unsafe, or undefined when it is safe. */
function unsafe(e: ts.Expression): string | undefined {
  if (ts.isParenthesizedExpression(e)) return unsafe(e.expression);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e))
    return undefined;
  if (ts.isConditionalExpression(e)) return unsafe(e.whenTrue) ?? unsafe(e.whenFalse);
  if (ts.isCallExpression(e)) {
    const name = callee(e);
    if (QUOTING.has(name)) return undefined;
    if (CODE_CALLS.has(name)) return undefined;
  }
  if (ts.isIdentifier(e) && CODE_NAMES.has(e.text)) return undefined;
  if (NUMBERS.has(e.getText(file))) return undefined;
  return e.getText(file);
}

describe('replay.ts writes guide text only through q(), comment() or as a number (H2)', () => {
  it('has no other interpolation into generated code', () => {
    const problems: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && QUOTING.has(callee(n))) return; // anything goes inside
      if (ts.isTemplateSpan(n)) {
        // envName() and comment() build their own text; their results are checked where used.
        const helper = inside(
          n,
          (p) => ts.isFunctionDeclaration(p) && ['envName', 'comment'].includes(p.name?.text ?? ''),
        );
        const why = helper ? undefined : unsafe(n.expression);
        if (why) {
          const { line } = file.getLineAndCharacterOfPosition(n.getStart(file));
          problems.push(`line ${line + 1}: \${${why}}`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(file);
    expect(problems).toEqual([]);
  });

  it('passes envName() output only into comments', () => {
    const calls: ts.CallExpression[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && callee(n) === 'envName') calls.push(n);
      ts.forEachChild(n, visit);
    };
    visit(file);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls)
      expect(inside(c, (p) => ts.isCallExpression(p) && callee(p) === 'comment')).toBe(true);
  });

  it('comment() keeps text on one line, without control characters, at most 200 long', () => {
    expect(comment('a\rb\nc\u2028d\u2029e\tf\u0007g\u0085h')).toBe('a b c d e f g h');
    expect(comment('x'.repeat(500))).toHaveLength(200);
  });
});
