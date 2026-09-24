export interface DebouncedFunction<Args extends any[]> {
  (...args: Args): void;
  cancel: () => void;
}

export function debounce<Args extends any[]>(fn: (...args: Args) => void, delay = 100): DebouncedFunction<Args> {
  let timer: number | undefined;

  const debounced = function <U>(this: U, ...args: Args) {
    const context = this;

    if (timer !== undefined) {
      window.clearTimeout(timer);
    }

    timer = window.setTimeout(() => {
      timer = undefined;
      fn.apply(context, args);
    }, delay);
  } as DebouncedFunction<Args>;

  debounced.cancel = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };

  return debounced;
}
