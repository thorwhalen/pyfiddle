/**
 * `pyfiddle/react`: the DOM renderer mounted in React. One implementation (the plain-DOM one); these
 * components only mount and unmount it, so a React page and a plain page behave the same.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { mountFiddle, type FiddleOptions } from './dom/fiddle';
import { mountPage, type PageHandle, type PageOptions } from './dom/page';
import type { PageInput, ResolvedPage } from './page/schema';
import { sharedRuntime, type PythonRuntime } from './runtime/runtime';

/**
 * A fiddle page. It is mounted again when the page's content or `options.teacher` changes, never on
 * a mere new object (a page built during render, a store adapter re-created on every keystroke): the
 * other options are read at mount time, so give the component a new `key` to apply a new store or
 * runtime.
 */
export function FiddlePage({ page, options, className, onMount }: { page: PageInput | ResolvedPage; options?: PageOptions; className?: string; onMount?: (h: PageHandle) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ page, options, onMount });
  latest.current = { page, options, onMount };
  const content = useMemo(() => JSON.stringify(page), [page]);
  const teacher = !!options?.teacher;
  useEffect(() => {
    if (!ref.current) return;
    const handle = mountPage(ref.current, latest.current.page, latest.current.options);
    latest.current.onMount?.(handle);
    return () => handle.destroy();
  }, [content, teacher]);
  return <div ref={ref} className={className} />;
}

/** One fiddle. Mounted again when `id` changes; the other props are read at mount time. */
export function Fiddle(props: FiddleOptions & { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (!ref.current) return;
    const handle = mountFiddle(ref.current, latest.current);
    return () => handle.destroy();
  }, [props.id]);
  return <div ref={ref} className={props.className} />;
}

/** The runtime's state (idle, loading with progress, running, ready, failed), for a host's own UI. */
export function usePythonState(runtime: PythonRuntime = sharedRuntime()) {
  return useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);
}
