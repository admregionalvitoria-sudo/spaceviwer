/** Bound optional metadata without leaving a rejected promise or a live timer. */
export function optionalWithin<T>(work: Promise<T>, fallback: T, timeoutMs = 3000): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    work.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(fallback); });
  });
}
