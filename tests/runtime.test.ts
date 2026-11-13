import { describe, expect, it } from 'vitest';
import { BUSY, CRASHED, createPythonRuntime } from '../src/runtime/runtime';
import { fakeRuntime, fakeWorker, tick } from './fakes';

describe('the Python runtime', () => {
  it('starts Python on the first run only, streams output and reports the check', async () => {
    const { rt, fake, made } = fakeRuntime();
    expect(rt.getState().status).toBe('idle');
    const out: string[] = [];
    const r = await rt.run('print:hello', { owner: 'a', check: 'ok', onOutput: (_, t) => out.push(t) });
    expect(out).toEqual(['hello']);
    expect(r.check).toEqual({ passed: true });
    await rt.run('print:again', { owner: 'b', onOutput: () => {} });
    expect(made()).toBe(1);
    expect(fake.sent.filter((m) => m.type === 'boot')).toHaveLength(1);
    expect(rt.getState().status).toBe('ready');
  });

  it('reports an error from the program', async () => {
    const { rt } = fakeRuntime();
    expect(await rt.run('raise', { owner: 'a', onOutput: () => {} })).toEqual({ error: 'Traceback: boom', check: undefined, interrupted: undefined });
  });

  it('warm() loads Python without running anything', async () => {
    const { rt, fake } = fakeRuntime();
    await rt.warm();
    expect(rt.getState().status).toBe('ready');
    expect(fake.sent.map((m) => m.type)).toEqual(['boot']);
  });

  it('Stop ends a runaway program (no cross-origin isolation: by ending the worker), and the next run starts afresh', async () => {
    const { rt, fake, made } = fakeRuntime();
    const states: string[] = [];
    rt.subscribe(() => states.push(rt.getState().status));
    const hung = rt.run('hang', { owner: 'a', onOutput: () => {} });
    await tick();
    expect(rt.getState()).toMatchObject({ status: 'running', owner: 'a' });
    rt.stop();
    expect(await hung).toEqual({ interrupted: true });
    expect(fake.terminated()).toBe(1);
    expect(rt.getState().status).toBe('idle');
    await rt.run('print:x', { owner: 'a', onOutput: () => {} });
    expect(made()).toBe(2);
    expect(states).toContain('loading');
  });

  it('runs one program at a time', async () => {
    const { rt } = fakeRuntime();
    const hung = rt.run('hang', { owner: 'a', onOutput: () => {} });
    await tick();
    expect(await rt.run('print:x', { owner: 'b', onOutput: () => {} })).toEqual({ error: BUSY });
    rt.stop();
    await hung;
  });

  it('a Run from another cell takes over: the running program is stopped and the new one runs', async () => {
    const { rt } = fakeRuntime();
    const hung = rt.run('hang', { owner: 'a', onOutput: () => {} });
    await tick();
    const out: string[] = [];
    const next = await rt.run('print:mine', { owner: 'b', preempt: true, onOutput: (_, t) => out.push(t) });
    expect(await hung).toEqual({ interrupted: true });
    expect(next.error).toBeUndefined();
    expect(out).toEqual(['mine']);
  });

  it('when two Runs wait for Python to load, only the newest runs', async () => {
    const { rt } = fakeRuntime();
    const first = rt.run('print:first', { owner: 'a', onOutput: () => {} });
    const second = rt.run('print:second', { owner: 'b', preempt: true, onOutput: () => {} });
    expect(rt.getState().owner).toBe('b');
    expect(await first).toEqual({ interrupted: true });
    expect((await second).error).toBeUndefined();
  });

  it('a crashed interpreter is reported in plain words and replaced on the next Run', async () => {
    const { rt, made } = fakeRuntime();
    expect(await rt.run('crash', { owner: 'a', onOutput: () => {} })).toEqual({ error: CRASHED });
    expect(rt.getState().status).toBe('idle');
    expect((await rt.run('print:x', { owner: 'a', onOutput: () => {} })).error).toBeUndefined();
    expect(made()).toBe(2);
  });

  it('Stop during a slow first download cancels it at once, and nothing comes back to life', async () => {
    const fake = fakeWorker();
    let release!: (url: string) => void;
    const rt = createPythonRuntime({
      indexURL: (onProgress) => {
        onProgress({ loaded: 1, total: 10 });
        return new Promise((r) => {
          release = r;
        });
      },
      makeWorker: () => fake.w,
    });
    const run = rt.run('print:x', { owner: 'a', onOutput: () => {} });
    await tick();
    expect(rt.getState()).toMatchObject({ status: 'loading', progress: { loaded: 1, total: 10 } });
    rt.stop();
    expect(await run).toEqual({ interrupted: true });
    release('https://example.test/py/');
    await tick();
    expect(rt.getState().status).toBe('idle');
    expect(fake.sent).toHaveLength(0);
  });

  it('a failed start is reported, and the next run tries again', async () => {
    let fail = true;
    const fake = fakeWorker();
    const rt = createPythonRuntime({
      indexURL: async () => {
        if (fail) throw new Error('offline');
        return 'u/';
      },
      makeWorker: () => fake.w,
    });
    const r = await rt.run('print:x', { owner: 'a', onOutput: () => {} });
    expect(r.error).toMatch(/could not start: offline/);
    await tick();
    expect(rt.getState()).toMatchObject({ status: 'failed', error: 'offline' });
    fail = false;
    expect((await rt.run('print:x', { owner: 'a', onOutput: () => {} })).error).toBeUndefined();
  });
});
