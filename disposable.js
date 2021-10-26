import { createIterator } from "./iterator-prototypes.js";
import { symbolDispose } from "./symbols.js";

/** @typedef {typeof import("./index.js").Disposable} DisposableConstructor */
/** @typedef {import("./index.js").Disposable} IDisposable */
/** @typedef {import("./index.js").Disposable.UsingValue} DisposableValue */

/** @typedef {import("./index.js").Disposable.OnDispose<any>} DisposeMethod */
/** @typedef {(value: any) => DisposableValue} MapFn */
/**
 * @callback DisposableUsing
 * @param {any} value
 * @param {DisposeMethod} [onDispose]
 * @returns {unknown}
 */

/**
 * @typedef {Object} DisposableResourceRecord
 * @property {unknown} resourceValue
 * @property {'sync'} hint
 * @property {DisposeMethod} disposeMethod
 */

/** @type {MapFn} */
const defaultMapFn = (value) => value;

/** @type {(value: any, resource: any) => DisposableResourceRecord | undefined } */
const getRecordFromValue = (value, resource) => {
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
      hint: "sync",
      disposeMethod: value,
    };
  }
  return undefined;
};

/**
 * @template {DisposableValue} T
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
 * @param {Iterator<unknown>} iter
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
  const tryOrClose = (fn, closeIter) => {
    try {
      return fn();
    } catch (err) {
      closed = true;
      try {
        dispose();
      } catch (disposeError) {
        throw new AggregateError([err, disposeError]);
      } finally {
        if (closeIter && hasReturn) {
          // @ts-ignore
          iter.return();
        }
      }
      throw err;
    }
  };

  /** @type {IterableIterator<any>} */
  const wrapped = createIterator({
    /** @param {[] | [any]} args */
    next: (...args) => {
      tryOrClose(dispose, true);
      const nextResult = closed
        ? { value: undefined, done: true }
        : tryOrClose(() => iter.next(...args));
      tryOrClose(() => {
        if (!nextResult.done) {
          /** @type {DisposableResourceRecord[]} */
          const stack = [];
          const { value } = nextResult;
          addDisposable(getDisposable(value), value, stack);
          // Call dispose in case of some re-entrancy
          dispose();
          pendingRecord = stack[0];
        }
      }, true);
      return nextResult;
    },
    /** @param {[] | [any]} args */
    return: (...args) => {
      closed = true;
      dispose();
      if (hasReturn) {
        // @ts-ignore
        return iter.return(...args);
      } else {
        return { value: args[0], done: true };
      }
    },
    /** @param {[] | [any]} args */
    throw: (...args) => {
      closed = true;
      dispose();
      if (hasThrow) {
        // @ts-ignore
        return iter.throw(...args);
      } else {
        if (hasReturn) {
          // @ts-ignore
          iter.return(undefined);
        }
        throw args[0];
      }
    },
    [Symbol.iterator]: () => wrapped,
    [symbolDispose]() {
      // @ts-ignore
      wrapped.return();
    },
  });

  return wrapped;
};

const Disposable = /** @type {DisposableConstructor} */ (
  class Disposable {
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
        hint: "sync",
        disposeMethod: onDispose,
      });
    }

    [symbolDispose]() {
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
      /** @type {Disposable} */
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
        res: /** @type {IDisposable} */ (res),
        stack,
      };
    }

    /**
     * @param {Iterable<unknown>} disposables
     * @param {MapFn} [mapFn]
     */
    static from(disposables, mapFn = defaultMapFn) {
      const { res, stack } = (this || Disposable).#makeEmpty();

      const errors = [];
      let iterationError;
      try {
        const syncIterable = /** @type {Iterable<unknown>} */ (disposables);
        for (const disposable of syncIterable) {
          addDisposable(mapFn(disposable), disposable, stack, (err) =>
            errors.push(err)
          );
        }
      } catch (err) {
        iterationError = err;
      }

      if (iterationError || errors.length) {
        const multipleResources = stack.length;
        try {
          res[symbolDispose]();
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
     * @param {Iterable<unknown>} values
     * @param {MapFn} [mapFn]
     */
    static usingFrom(values, mapFn = defaultMapFn) {
      const syncIterable = /** @type {Iterable<unknown>} */ (values);

      if (typeof syncIterable[Symbol.iterator] !== "function") {
        throw new TypeError("values is not iterable");
      }

      if (typeof mapFn !== "function") {
        throw new TypeError("mapFn is not a function");
      }

      return {
        [Symbol.iterator]() {
          const iterator = syncIterable[Symbol.iterator]();
          return wrapIterator(iterator, mapFn);
        },
      };
    }

    static [Symbol.iterator]() {
      const { res, stack } = this.#makeEmpty();

      /** @type {DisposableUsing | undefined} */
      let using = (value, onDispose) =>
        typeof onDispose === "function"
          ? addDisposable(onDispose, value, stack)
          : addDisposable(value, value, stack);

      /** @type {import("./index.js").Disposable.UsingIterator} */
      const iterator = createIterator({
        next() {
          if (using) {
            const value = using;
            using = undefined;
            return {
              value,
              done: false,
            };
          } else {
            res[symbolDispose]();
            return {
              value: undefined,
              done: true,
            };
          }
        },
        return() {
          using = undefined;
          try {
            res[symbolDispose]();
          } catch (disposeError) {
            // TODO: find a way to report when `return` triggered by a throw
            throw disposeError;
          }
          return {
            value: undefined,
            done: true,
          };
        },
        throw(err) {
          using = undefined;
          try {
            res[symbolDispose]();
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

export { Disposable as default };
