import { createAsyncIterator } from "./iterator-prototypes.js";
import { symbolDispose, symbolAsyncDispose } from "./symbols.js";

/** @typedef {typeof import("./index.js").AsyncDisposable} AsyncDisposableConstructor */
/** @typedef {import("./index.js").AsyncDisposable} IAsyncDisposable */
/** @typedef {import("./index.js").Disposable} IDisposable */
/** @typedef {import("./index.js").AsyncDisposable.IterValue} DisposableValue */

/** @typedef {() => void | PromiseLike<void>} DisposeMethod */
/** @typedef {(value: any) => DisposableValue} MapFn */
/**
 * @callback DisposableUsing
 * @param {unknown} disposable
 * @param {MapFn} [mapFn]
 * @returns {unknown}
 */

/**
 * @typedef {Object} DisposableResourceRecord
 * @property {unknown} resourceValue
 * @property {'sync' | 'async'} hint
 * @property {DisposeMethod} disposeMethod
 */

/** @type {MapFn} */
const defaultMapFn = (value) => value;

/** @type {(value: any) => DisposableResourceRecord | undefined } */
const getRecordFromValue = (value) => {
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
    }
  }
  return undefined;
};

/**
 * @template {DisposableValue} T
 * @param {T} disposable
 * @param {Array<DisposableResourceRecord>} stack
 * @param {(err: unknown) => void} [onError]
 */
const addDisposable = (disposable, stack, onError) => {
  try {
    const record = getRecordFromValue(disposable);
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
    const { disposeMethod, resourceValue } = pendingRecord;
    pendingRecord = undefined;
    return disposeMethod.call(resourceValue);
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
          addDisposable(getDisposable(nextResult.value), stack);
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

const AsyncDisposable = /** @type {AsyncDisposableConstructor} */ (
  class AsyncDisposable {
    /** @type {Array<DisposableResourceRecord>} */
    #resourceStack = [];

    /** @type {'pending'|'disposed'} */
    #state = "pending";

    /**
     * @param {DisposeMethod} onDispose
     */
    constructor(onDispose) {
      if (typeof onDispose !== "function") {
        throw new TypeError("Invalid onDispose argument");
      }
      this.#resourceStack.push({
        resourceValue: null,
        hint: "async",
        disposeMethod: onDispose,
      });
    }

    async [symbolAsyncDispose]() {
      if (this.#state === "disposed") {
        return;
      }
      this.#state = "disposed";

      const errors = [];
      const multipleResources = this.#resourceStack.length > 1;

      while (this.#resourceStack.length) {
        const { resourceValue, hint, disposeMethod } =
          /** @type {DisposableResourceRecord} */ (this.#resourceStack.pop());

        try {
          switch (hint) {
            case "sync":
              disposeMethod.call(resourceValue);
              break;
            case "async":
              await disposeMethod.call(resourceValue);
              break;
            default:
              throw new TypeError("Invalid disposable record");
          }
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

    static #makeEmpty() {
      const dummyDispose = () => {};
      /** @type {AsyncDisposable} */
      const res = Reflect.construct(this, [dummyDispose]);

      const stack = res.#resourceStack;

      if (
        stack.length !== 1 ||
        /** @type {DisposableResourceRecord} */ (stack.pop()).disposeMethod !==
          dummyDispose
      ) {
        throw new TypeError("Created invalid disposable");
      }

      return {
        res: /** @type {IAsyncDisposable} */ (res),
        stack,
      };
    }

    /**
     * @param {Iterable<unknown> | AsyncIterable<unknown>} disposables
     * @param {MapFn} [mapFn]
     */
    static async from(disposables, mapFn = defaultMapFn) {
      const { res, stack } = (this || AsyncDisposable).#makeEmpty();

      const errors = [];
      let iterationError;
      try {
        const syncIterable = /** @type {Iterable<unknown>} */ (disposables);
        if (Symbol.iterator in syncIterable) {
          for (const disposable of syncIterable) {
            addDisposable(mapFn(disposable), stack, (err) => errors.push(err));
          }
        } else {
          for await (const disposable of disposables) {
            addDisposable(mapFn(disposable), stack, (err) => errors.push(err));
          }
        }
      } catch (err) {
        iterationError = err;
      }

      if (iterationError || errors.length) {
        const multipleResources = stack.length;
        try {
          await res[symbolAsyncDispose]();
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
            Object.defineProperty(error, "cause", {
              value: iterationError,
              enumerable: false,
              writable: true,
              configurable: true,
            });
          }
        }
        throw error;
      }

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

    static [Symbol.asyncIterator]() {
      const { res, stack } = this.#makeEmpty();

      /** @type {DisposableUsing | undefined} */
      let using = (disposable, mapFn = defaultMapFn) =>
        addDisposable(mapFn(disposable), stack);

      /** @type {import("./index.js").AsyncDisposable.UsingAsyncIterator} */
      const iterator = createAsyncIterator({
        async next() {
          if (using) {
            const value = using;
            using = undefined;
            return {
              value,
              done: false,
            };
          } else {
            await res[symbolAsyncDispose]();
            return {
              value: undefined,
              done: true,
            };
          }
        },
        async return() {
          using = undefined;
          try {
            await res[symbolAsyncDispose]();
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
          using = undefined;
          try {
            await res[symbolAsyncDispose]();
          } catch (disposeError) {
            if (!("cause" in /** @type {Object}*/ (disposeError))) {
              Object.defineProperty(disposeError, "cause", {
                value: err,
                enumerable: false,
                writable: true,
                configurable: true,
              });
              throw disposeError;
            } else {
              throw new AggregateError([err, disposeError]);
            }
          }
          throw err;
        },
      });

      return iterator;
    }
  }
);

export { AsyncDisposable as default };