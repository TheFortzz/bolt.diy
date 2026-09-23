export function throttle<Args extends any[]>(fn: (...args: Args) => void, wait = 100) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latestArgs: Args | undefined;
  let latestThis: unknown;

  return function (this: unknown, ...args: Args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    latestArgs = args;
    latestThis = this;

    if (remaining <= 0) {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }

      last = now;
      fn.apply(latestThis, args);
      return;
    }

    if (timer === undefined) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = undefined;

        if (latestArgs) {
          fn.apply(latestThis, latestArgs);
        }
      }, remaining);
    }
  };
}
