/** Test doubles: a scripted worker (`print:<text>`, `raise`, `crash`, `hang`). */
import type { FromWorker, ToWorker } from '../src/runtime/protocol';
import { createPythonRuntime, type RuntimeOptions } from '../src/runtime/runtime';

export function fakeWorker() {
  const sent: ToWorker[] = [];
  let terminated = 0;
  const w = {
    onmessage: null as ((e: MessageEvent<FromWorker>) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    postMessage(m: ToWorker) {
      sent.push(m);
      const reply = (r: FromWorker) => queueMicrotask(() => w.onmessage?.({ data: r } as MessageEvent<FromWorker>));
      if (m.type === 'boot') reply({ type: 'ready', version: 'test' });
      else if (m.code.startsWith('print:')) {
        reply({ type: 'out', id: m.id, stream: 'stdout', text: m.code.slice(6) });
        reply({ type: 'done', id: m.id, check: m.check ? (m.check.startsWith('ok') ? { passed: true } : { passed: false, message: m.check }) : undefined });
      } else if (m.code === 'raise') reply({ type: 'done', id: m.id, error: 'Traceback: boom' });
      else if (m.code === 'crash') reply({ type: 'fatal', id: m.id, message: 'Maximum call stack size exceeded' });
      // 'hang' never answers
    },
    terminate() {
      terminated++;
    },
  };
  return { w, sent, terminated: () => terminated };
}

export function fakeRuntime(options: RuntimeOptions = {}) {
  const fake = fakeWorker();
  let made = 0;
  const rt = createPythonRuntime({
    indexURL: async () => 'https://example.test/py/',
    makeWorker: () => {
      made++;
      return fake.w;
    },
    ...options,
  });
  return { rt, fake, made: () => made };
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
