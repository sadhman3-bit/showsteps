import { describe, expect, it } from 'vitest';
import { createStep, type StepInit } from '../src/factory.js';
import { toMarkdown, toPlainText } from '../src/richText.js';
import type { Target } from '../src/schema.js';
import { cleanName, targetLabel, writeStepTitle } from '../src/stepText.js';

const web = { kind: 'web' as const, url: 'https://contoso.sharepoint.com/sites/finance' };
const box = { bbox: { x: 0, y: 0, w: 10, h: 10 }, point: { x: 5, y: 5 }, selectors: [] };
const target = (t: Partial<Target>): Target => ({ ...box, ...t });

const md = (init: Omit<StepInit, 'app'> & { app?: StepInit['app'] }) =>
  toMarkdown(writeStepTitle(createStep({ app: web, ...init })));

describe('writeStepTitle: every action', () => {
  it('click', () => {
    expect(md({ action: 'click', target: target({ role: 'button', name: 'Save' }) })).toBe(
      'Click **Save**',
    );
  });

  it('double_click', () => {
    expect(md({ action: 'double_click', target: target({ name: 'Q3 report.xlsx' }) })).toBe(
      'Double-click **Q3 report.xlsx**',
    );
  });

  it('right_click', () => {
    expect(md({ action: 'right_click', target: target({ name: 'Invoices' }) })).toBe(
      'Right-click **Invoices**',
    );
  });

  it('type with a variable', () => {
    expect(
      md({
        action: 'type',
        target: target({ role: 'textbox', name: 'Invoice no.' }),
        input: { mode: 'ask', variable: 'invoice_number', sensitive: false },
      }),
    ).toBe('Type **{{invoice\\_number}}** into **Invoice no.**');
  });

  it('type with a fixed value', () => {
    const rt = writeStepTitle(
      createStep({
        app: web,
        action: 'type',
        target: target({ role: 'textbox', name: 'Supplier' }),
        input: { mode: 'fixed', value: 'Harbour Paper Co.', sensitive: false },
      }),
    );
    expect(toPlainText(rt)).toBe('Type Harbour Paper Co. into Supplier');
    expect(rt.spans.filter((s) => s.bold).map((s) => s.text)).toEqual([
      'Harbour Paper Co.',
      'Supplier',
    ]);
  });

  it('type into a password field never shows the value', () => {
    expect(
      md({
        action: 'type',
        target: target({ role: 'textbox', name: 'Password' }),
        input: { mode: 'fixed', sensitive: true },
      }),
    ).toBe('Enter your password');
  });

  it('type into another sensitive field names the field only', () => {
    expect(
      md({
        action: 'type',
        target: target({ role: 'textbox', name: 'Card number' }),
        input: { mode: 'fixed', sensitive: true },
      }),
    ).toBe('Enter **Card number**');
  });

  it('type with no value', () => {
    expect(md({ action: 'type', target: target({ role: 'textbox', name: 'Notes' }) })).toBe(
      'Fill in **Notes**',
    );
  });

  it('select', () => {
    expect(
      md({
        action: 'select',
        target: target({ role: 'combobox', name: 'Currency' }),
        input: { mode: 'fixed', value: 'AUD', sensitive: false },
      }),
    ).toBe('Select **AUD** from **Currency**');
  });

  it('check, uncheck and radio', () => {
    expect(md({ action: 'check', target: target({ role: 'checkbox', name: 'I agree' }) })).toBe(
      'Check **I agree**',
    );
    expect(
      md({
        action: 'check',
        target: target({ role: 'checkbox', name: 'Urgent' }),
        input: { mode: 'fixed', value: 'false', sensitive: false },
      }),
    ).toBe('Uncheck **Urgent**');
    expect(md({ action: 'check', target: target({ role: 'radio', name: 'Cheque' }) })).toBe(
      'Select **Cheque**',
    );
  });

  it('key', () => {
    expect(md({ action: 'key', key: 'Enter' })).toBe('Press **Enter**');
    expect(md({ action: 'key', key: 'Ctrl+S' })).toBe('Press **Ctrl+S**');
  });

  it('navigate (web and desktop)', () => {
    expect(md({ action: 'navigate' })).toBe('Go to **contoso.sharepoint.com**');
    expect(md({ action: 'navigate', app: { kind: 'web', url: 'https://www.example.com/a' } })).toBe(
      'Go to **example.com**',
    );
    expect(
      md({
        action: 'navigate',
        app: { kind: 'desktop', processName: 'notepad.exe', windowTitle: 'Untitled - Notepad' },
      }),
    ).toBe('Open **Untitled - Notepad**');
  });

  it('scroll', () => {
    expect(md({ action: 'scroll' })).toBe('Scroll down the page');
    expect(md({ action: 'scroll', target: target({ name: 'Recent invoices' }) })).toBe(
      'Scroll to **Recent invoices**',
    );
  });

  it('hover', () => {
    expect(md({ action: 'hover', target: target({ name: 'Help' }) })).toBe('Hover over **Help**');
  });

  it('wait', () => {
    expect(md({ action: 'wait' })).toBe('Wait for the page to finish loading');
    expect(md({ action: 'wait', target: target({ name: 'Recent invoices' }) })).toBe(
      'Wait for **Recent invoices** to appear',
    );
  });

  it('upload uses the file name only', () => {
    expect(
      md({
        action: 'upload',
        target: target({ name: 'Attach invoice PDF' }),
        input: { mode: 'fixed', value: 'C:\\fakepath\\invoice.pdf', sensitive: false },
      }),
    ).toBe('Upload **invoice.pdf**');
    expect(md({ action: 'upload', target: target({ name: 'Attach invoice PDF' }) })).toBe(
      'Upload a file to **Attach invoice PDF**',
    );
  });

  it('manual', () => {
    expect(md({ action: 'manual' })).toBe('Complete this step manually');
  });
});

describe('target naming fallbacks', () => {
  it('prefers name, then label, text, placeholder', () => {
    expect(targetLabel(target({ name: 'A', label: 'B', text: 'C', placeholder: 'D' }))).toBe('A');
    expect(targetLabel(target({ label: 'B', text: 'C', placeholder: 'D' }))).toBe('B');
    expect(targetLabel(target({ text: 'C', placeholder: 'D' }))).toBe('C');
    expect(targetLabel(target({ placeholder: 'D' }))).toBe('D');
  });

  it('falls back to a short role description', () => {
    expect(md({ action: 'click', target: target({ role: 'searchbox' }) })).toBe(
      'Click the search box',
    );
    expect(md({ action: 'click', target: target({}) })).toBe('Click the highlighted area');
  });

  it('collapses whitespace and truncates long names', () => {
    expect(cleanName('  Save \n  draft ')).toBe('Save draft');
    const long = 'x'.repeat(100);
    expect(cleanName(long)).toHaveLength(60);
    expect(cleanName(long)?.endsWith('…')).toBe(true);
  });

  it('uses UI Automation names for desktop targets', () => {
    expect(
      md({
        action: 'click',
        app: { kind: 'desktop', processName: 'EXCEL.EXE', windowTitle: 'Book1 - Excel' },
        target: target({ uia: { name: 'Bold', controlType: 'Button' } }),
      }),
    ).toBe('Click **Bold**');
    expect(
      md({
        action: 'click',
        app: { kind: 'desktop', processName: 'EXCEL.EXE', windowTitle: 'Book1 - Excel' },
        target: target({ uia: { controlType: 'Button' } }),
      }),
    ).toBe('Click the button');
  });
});
