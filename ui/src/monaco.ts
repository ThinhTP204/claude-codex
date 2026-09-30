// Bundle Monaco locally (no CDN) so the app works offline.
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

// A viewer without the project's tsconfig/node_modules would show bogus errors
// ("Cannot find module '@/…'"), so turn TS/JS diagnostics off.
// Monaco >= 0.55 exposes this as `monaco.typescript`; older builds as `monaco.languages.typescript`.
const ts = (monaco as any).typescript ?? (monaco.languages as any).typescript;
if (ts) {
  for (const d of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
    d.setCompilerOptions({ jsx: ts.JsxEmit?.React ?? 2, allowJs: true, target: 99 });
  }
}

loader.config({ monaco });
export { monaco };
