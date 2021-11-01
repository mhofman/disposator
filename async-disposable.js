import { createAsyncIterator } from "./iterator-prototypes.js";
import { symbolDispose, symbolAsyncDispose } from "./symbols.js";

/** @typedef {import("./async-disposable.js").AsyncDisposable.Constructor} DisposableConstructor */
/** @typedef {import("./async-disposable.js").AsyncDisposable} IAsyncDisposable */
/** @typedef {import("./disposable.js").Disposable} IDisposable */
/** @typedef {import("./async-disposable.js").AsyncDisposable.Resource} DisposableResource */

/** @typedef {import("./async-disposable.js").AsyncDisposable.OnDispose<any>} DisposeMethod */
/** @typedef {(value: any) => DisposableResource} MapFn */
/** @typedef {import("./async-disposable.js").AsyncDisposable.Aggregate} DisposableAggregate */

/**
 * @typedef {Object} DisposableResourceRecord
 * @property {unknown} resourceValue
 * @property {'sync' | 'async'} hint
 * @property {DisposeMethod} disposeMethod
 */

/** @type {MapFn} */
const defaultMapFn = (value) => value;

/** @type {(value: any, resource: any) => DisposableResourceRecord | undefined } */
const getRecordFromValue = (value, resource) => {
  const asyncDispose = value[symbolAsyncDispose];
  const asyncDisposeType = typeof asyncDispose;

  if (asyncDisposeType !== "undefined") {
    if (asyncDisposeType === "function") {
      return {
        resourceValue: value,
        hint: "async",
        disposeMethod: asyncDispose,
      };
    }
  } else {
    const syncDispose = value[symbolDispose];
    if (typeof syncDispose === "function") {
      return {
        resourceValue: value,
        hint: "sync",
        disposeMethod: syncDispose,
      };
    } else if (typeof value === "function") {
      return {
        resourceValue: resource,
        hint: "async",
        disposeMethod: value,
      };
    }
  }
  return undefined;
};

/**
 * @template {DisposableResource} T
 * @param {T} disposable
 * @param {unknown} resource
 * @param {Array<DisposableResourceRecord>} stack
 * @param {(err: unknown) => void} [onError]
 */
const addDisposable = (disposable, resource, stack, onError) => {
  try {
    const record = getRecordFromValue(disposable, resource);
    if (!record) {
      throw new TypeError("Invalid disposable");
    } else {
      stack.push(record);
    }
  } catch (error) {
    if (onError) {
      onError(error);
    } else {
      throw error;
    }
  }
  return disposable;
};

/**
 * @param {DisposableResourceRecord} record
 * @returns {void | PromiseLike<void>}
 */
const disposeRecord = ({ resourceValue, hint, disposeMethod }) => {
  switch (hint) {
    case "sync":
      return void disposeMethod.call(resourceValue);
    case "async":
      return disposeMethod.call(resourceValue);
    default:
      throw new TypeError("Invalid disposable record");
  }
};

/**
 * @param {unknown} error
 * @param {unknown} cause
 */
const mergeCause = (error, cause) => {
  let result;

  try {
    if (!("cause" in /** @type {Object}*/ (error))) {
      Object.defineProperty(error, "cause", {
        value: cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
      result = error;
    }
  } catch (e) {}

  return result || new AggregateError([cause, error]);
};

/**
 * @param {Iterator<unknown> | AsyncIterator<unknown>} iter
 * @param {MapFn} getDisposable
 */
const wrapIterator = (iter, getDisposable) => {
  const hasReturn = typeof iter.return === "function";
  const hasThrow = typeof iter.throw === "function";

  let closed = false;

  /** @type {DisposableResourceRecord | undefined} */
  let pendingRecord;
  const dispose = () => {
    if (!pendingRecord) return;
    const record = pendingRecord;
    pendingRecord = undefined;
    return disposeRecord(record);
  };

  /**
   * @template T
   * @param {() => T} fn
   * @param {boolean} [closeIter]
   */
  const tryOrClose = async (fn, closeIter) => {
    try {
      return fn();
    } catch (err) {
      closed = true;
      try {
        await dispose();
      } catch (disposeError) {
        throw new AggregateError([err, disposeError]);
      } finally {
        if (closeIter && hasReturn) {
          // @ts-ignore
          await iter.return();
        }
      }
      throw err;
    }
  };

  /** @type {AsyncIterableIterator<any>} */
  const wrapped = createAsyncIterator({
    /** @param {[] | [any]} args */
    next: async (...args) => {
      await tryOrClose(dispose, true);
      const nextResult = closed
        ? { value: undefined, done: true }
        : await tryOrClose(async () => iter.next(...args));
      await tryOrClose(async () => {
        if (!nextResult.done) {
          /** @type {DisposableResourceRecord[]} */
          const stack = [];
          const { value } = nextResult;
          addDisposable(getDisposable(value), value, stack);
          // Call dispose in case of some re-entrancy
          await dispose();
          pendingRecord = stack[0];
        }
      }, true);
      return nextResult;
    },
    /** @param {[] | [any]} args */
    return: async (...args) => {
      closed = true;
      await dispose();
      if (hasReturn) {
        // @ts-ignore
        return iter.return(...args);
      } else {
        return { value: args[0], done: true };
      }
    },
    /** @param {[] | [any]} args */
    throw: async (...args) => {
      closed = true;
      await dispose();
      if (hasThrow) {
        // @ts-ignore
        return iter.throw(...args);
      } else {
        if (hasReturn) {
          // @ts-ignore
          await iter.return(undefined);
        }
        throw args[0];
      }
    },
    [Symbol.asyncIterator]: () => wrapped,
    async [symbolAsyncDispose]() {
      // @ts-ignore
      await wrapped.return();
    },
  });

  return wrapped;
};

/**
 * @template T
 * @param {T} value
 * @param {IAsyncDisposable} disposable
 * @returns {import("./async-disposable.js").AsyncDisposable.UsingIterator<T>}
 */
const getIterator = (value, disposable) => {
  /** @type {IAsyncDisposable | undefined} */
  let res = disposable;

  let used = false;

  return createAsyncIterator({
    async next() {
      if (!used && res) {
        used = true;
        return {
          value,
          done: false,
        };
      } else {
        if (res) {
          await res[symbolAsyncDispose]();
          res = undefined;
        }
        return {
          value: undefined,
          done: true,
        };
      }
    },
    async return() {
      used = true;
      try {
        if (res) {
          await res[symbolAsyncDispose]();
          res = undefined;
        }
      } catch (disposeError) {
        // TODO: find a way to report when `return` triggered by a throw
        throw disposeError;
      }
      return {
        value: undefined,
        done: true,
      };
    },
    async throw(err) {
      used = true;
      try {
        if (res) {
          await res[symbolAsyncDispose]();
          res = undefined;
        }
      } catch (disposeError) {
        err = mergeCause(disposeError, err);
      }
      throw err;
    },
  });
};

export const AsyncDisposable = /** @type {DisposableConstructor} */ (
  class AsyncDisposable {
    /** @type {Array<DisposableResourceRecord>} */
    #resourceStack = [];

    /** @type {'pending'|'disposed'} */
    #state = "pending";

    /**
     * @param {DisposableResource[]} args
     */
    constructor(...args) {
      Object.defineProperty(this, "using", {
        value: this.using.bind(this),
        configurable: true,
        writable: true,
        enumerable: true,
      });

      if (args.length) {
        let fromDone = false;
        let fromError;
        this.#from(args, undefined, (err) => {
          fromDone = true;
          fromError = err;
        });
        if (fromError) {
          throw fromError;
        }
        if (!fromDone) {
          throw new Error("Internal Error");
        }
      }
    }

    async [symbolAsyncDispose]() {
      if (this.#state === "disposed") {
        return;
      }
      this.#state = "disposed";

      const errors = [];
      const multipleResources = this.#resourceStack.length > 1;

      while (this.#resourceStack.length) {
        const record = /** @type {DisposableResourceRecord} */ (
          this.#resourceStack.pop()
        );

        try {
          const res = disposeRecord(record);
          if (res !== undefined) await res;
        } catch (err) {
          errors.push(err);
        }
      }

      if (errors.length) {
        if (multipleResources) {
          throw new AggregateError(errors);
        } else {
          throw errors.pop();
        }
      }
    }

    /**
     * @param {any} value
     * @param {DisposeMethod} [onDispose]
     */
    using(value, onDispose) {
      const isDisposed = this.#state === "disposed";

      const stack = !isDisposed ? this.#resourceStack : [];

      typeof onDispose === "function"
        ? addDisposable(onDispose, value, stack)
        : addDisposable(value, value, stack);

      if (isDisposed) {
        /** @type {unknown} */
        let err = new TypeError(
          "Can't add resource, AsyncDisposable has already been disposed"
        );
        try {
          // For an "async" resource this will result in an unhandled rejection
          disposeRecord(/** @type {DisposableResourceRecord} */ (stack.pop()));
        } catch (disposeError) {
          err = mergeCause(disposeError, err);
        }
        throw err;
      }

      return value;
    }

    /**
     * @param {Iterable<unknown> | AsyncIterable<unknown>} disposables
     * @param {MapFn} [mapFn]
     * @param {(err?: unknown) => void} [syncDone]
     */
    async #from(disposables, mapFn = defaultMapFn, syncDone = undefined) {
      const res = this;
      const stack = res.#resourceStack;

      const errors = [];
      let iterationError;
      try {
        const asyncIterable = /** @type {AsyncIterable<unknown>} */ (
          disposables
        );
        const syncIterable = /** @type {Iterable<unknown>} */ (disposables);
        if (!syncDone && Symbol.asyncIterator in asyncIterable) {
          for await (const disposable of asyncIterable) {
            addDisposable(mapFn(disposable), disposable, stack, (err) =>
              errors.push(err)
            );
          }
        } else {
          for (const disposable of syncIterable) {
            addDisposable(mapFn(disposable), disposable, stack, (err) =>
              errors.push(err)
            );
          }
        }
      } catch (err) {
        iterationError = err;
      }

      if (iterationError || errors.length) {
        let disposeResult;
        const multipleResources = stack.length;
        try {
          disposeResult = res[symbolAsyncDispose]();
          if (!syncDone) {
            await disposeResult;
          }
        } catch (err) {
          const disposeErrors = multipleResources
            ? /** @type {AggregateError} */ (err).errors
            : [err];

          errors.push(...disposeErrors);
        }

        let error;
        if (!errors.length) {
          error = iterationError;
        } else {
          error = new AggregateError(errors);
          if (iterationError) {
            error = mergeCause(error, iterationError);
          }
        }
        if (syncDone) {
          syncDone(error);
          return disposeResult;
        } else {
          throw error;
        }
      } else if (syncDone) {
        syncDone();
      }
    }

    /**
     * @param {Iterable<unknown> | AsyncIterable<unknown>} disposables
     * @param {MapFn} [mapFn]
     */
    static async from(disposables, mapFn = undefined) {
      const res = new (this || AsyncDisposable)();
      await res.#from(disposables, mapFn);

      return res;
    }

    /**
     *
     * @param {Iterable<unknown> | AsyncIterable<unknown>} values
     * @param {MapFn} [mapFn]
     */
    static usingFrom(values, mapFn = defaultMapFn) {
      const asyncIterable = /** @type {AsyncIterable<unknown>} */ (values);
      const syncIterable = /** @type {Iterable<unknown>} */ (values);

      const isAsync = typeof asyncIterable[Symbol.asyncIterator] === "function";
      if (!isAsync) {
        if (typeof syncIterable[Symbol.iterator] !== "function") {
          throw new TypeError("values is not iterable");
        }
      }

      if (typeof mapFn !== "function") {
        throw new TypeError("mapFn is not a function");
      }

      return {
        [Symbol.asyncIterator]() {
          const iterator = isAsync
            ? asyncIterable[Symbol.asyncIterator]()
            : syncIterable[Symbol.iterator]();
          return wrapIterator(iterator, mapFn);
        },
      };
    }

    /**
     * @param {any} value
     * @param {DisposeMethod} [onDispose]
     */
    static using(value, onDispose) {
      // Wrap value even if it's already a disposable
      const disposable = new (this || AsyncDisposable)();
      disposable.using(value, onDispose);
      return getIterator(value, disposable);
    }

    static [Symbol.asyncIterator]() {
      const disposable = new (this || AsyncDisposable)();
      return getIterator(disposable, disposable);
    }
  }
);
