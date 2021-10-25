# Explicit Resource Management using `for-of`

This package provides an API inspired from the [Explicit Resource Management TC39 proposal](https://github.com/tc39/proposal-explicit-resource-management), leveraging the existing JavaScript semantics of `for-of` and `for-await-of`. It provides the same convenience of automatically disposing of resources when exiting a block, without requiring new syntax.

```js
import { Disposable } from "disposator";

for (const using of Disposable) {
  const resource = using(getResource());
  resource.doSomething();
  const other = using(resource.getOther());
  other.doStuff();
} // automatically cleanup, even when something throws
```

This package can be used either as a ponyfill through the default entrypoint, or as a polyfill modifying the global by using the `/polyfill.js` import path.

# API

## `Disposable` and `AsyncDisposable` interfaces

### `Disposable` Interface

An object is _disposable_ if has a `@@dispose` symbol method that performs explicit cleanup. The symbol is exported as `symbolDispose` by this package, or installed as `Symbol.dispose` through the polyfill.

```ts
import { symbolDispose } from "disposator";

interface Disposable {
  /**
   * Disposes resources within this object.
   */
  [symbolDispose](): void;
}
```

### `AsyncDisposable` Interface

An object is _async disposable_ if it has a `@@asyncDispose` symbol async method that performs explicit cleanup. The symbol is exported as `symbolAsyncDispose` by this package, or installed as `Symbol.asyncDispose` through the polyfill.

```ts
import { symbolAsyncDispose } from "disposator";

interface AsyncDisposable {
  /**
   * Disposes resources within this object.
   */
  [symbolAsyncDispose](): Promise<void>;
}
```

## `using` iterator helpers

The `Disposable` and `AsyncDisposable` exports both implement a special iterator helper which disposes of tracked resources when the iterator is closed. While these iterators only ever yield a single value (the helper function to add tracked resources), they are meant to be used with respectively the `for-of` and `for-await-of` statements which automatically closes their iterator in case of an early return or thrown error.

Errors thrown while disposing of tracked resources will be aggregated if multiple resources are tracked, and re-thrown once all tracked resources have been disposed of. If the disposal was triggered by an error thrown during the evaluation of the `for-of` or `for-await-of` block, that error takes precedence and errors occurring during the disposal are ignored. This is unlike `try-finally` statements where an error during the `finally` block takes precedence over the `try` block.

Tracking any value that doesn't implement the `Disposable` or `AsyncDisposable` interfaces throws an immediate `TypeError`.

### `for (const using of Disposable)`

```ts
/**
 * Add a disposable resource for tracking in the current iterator
 */
interface DisposableUsing {
  /**
   * @param disposable - The disposable resource to track
   * @returns The disposable resource
   */
  <T extends Disposable>(disposable: T): T;

  /**
   * @param value - The value to map a disposable resource from
   * @param mapFn - A function returning a disposable resource from the value
   * @returns The value
   */
  <T>(value: T, mapFn: (value: T) => Disposable): T;
}
```

The `using` helper function yielded by `Disposable`'s iterator can be used to track any _disposable_ resource. It captures the _disposable_ and its dispose method, then passes through the value. An optional `mapFn` second argument can generate from the value a _disposable_ resource to track. When the iterator closes, either from an early return, thrown error, or once the block completes, the tracked resources are disposed of in reverse order to which they were added.

### `for await (const using of AsyncDisposable)`

```ts
/**
 * Add a disposable or async disposable resource for tracking in the
 * current async iterator
 */
interface AsyncDisposableUsing {
  /**
   * @param disposable - The disposable or async disposable resource to track
   * @returns The disposable or async disposable resource
   */
  <T extends Disposable | AsyncDisposable>(disposable: T): T;

  /**
   * @param value - The value to map a disposable or async disposable resource from
   * @param mapFn - A function returning a disposable or async disposable resource
   * from the value
   * @returns The value
   */
  <T>(value: T, mapFn: (value: T) => Disposable | AsyncDisposable): T;
}
```

The `using` helper function yielded by `AsyncDisposable`'s iterator can be used to track any _disposable_ or _async disposable_ resource. It captures the _disposable_ and its dispose method, or the _async disposable_ and its async dispose method, then passes through the value. An optional `mapFn` second argument can generate from the value a _disposable_ or _async disposable_ resource to track. When the iterator closes, either from an early return, thrown error, or once the block completes, the tracked resources are disposed of in reverse order to which they were added.

The disposal of an _async disposable_ resource is awaited before moving to the next resource. The disposal of a _disposable_ resource is not awaited. The aggregate disposal step is always awaited even if all tracked resources are _disposable_ which are disposed of synchronously.

### Examples

The following show examples of using this package with various APIs, assuming those APIs implement the _disposable_ or _async disposable_ interfaces.

**WHATWG Streams Reader API**

```js
for await (const using of AsyncDisposable) {
  const reader = using(stream.getReader());
  const { value, done } = await reader.read();
}
```

**NodeJS FileHandle**

```js
for await (const using of AsyncDisposable) {
  const f1 = using(await fs.promises.open(s1, constants.O_RDONLY)),
  const f2 = using(await fs.promises.open(s2, constants.O_WRONLY));
  const buffer = Buffer.alloc(4092);
  const { bytesRead } = await f1.read(buffer);
  await f2.write(buffer, 0, bytesRead);
} // both handles are closed
```

**Transactional Consistency (ACID)**

```js
// roll back transaction if either action fails
for await (const using of AsyncDisposable) {
  const tx = using(transactionManager.startTransaction(account1, account2));
  await account1.debit(amount);
  await account2.credit(amount);

  // mark transaction success
  tx.succeeded = true;
} // transaction is committed
```

**Logging and tracing**

```js
// audit privileged function call entry and exit
function privilegedActivity() {
  for (const using of Disposable) {
    using(auditLog.startActivity("privilegedActivity")); // log activity start
    ...
  } // log activity end
}
```

**Async Coordination**

```js
import { Semaphore } from "...";
const sem = new Semaphore(1); // allow one participant at a time

export async function tryUpdate(record) {
  for (const using of Disposable) {
    using(await sem.wait()); // asynchronously block until we are the sole participant
    ...
  } // synchronously release semaphore and notify the next participant
}
```

## `usingFrom`: iterable of _disposable_

The `Disposable.usingFrom()` and `AsyncDisposable.usingFrom()` helpers streamline iterating over resources, ensuring that each iterated resource is disposed of. They do not dispose of resources that are not iterated over, e.g. if the iteration is terminated early.

The helpers works by generating a new iterable which captures a provided iterable, and an optional `mapFn` function. When an iterator is subsequently requested, the captured iterable's iterator is requested and wrapped. For each iteration, the iterator requests the next value from the wrapped iterator, tracks the resource, then yields the value. The optional `mapFn` function can be used to generate a _disposable_ or _async disposable_ resource from the iterated value.

After each iteration step, the resource is disposed of, regardless of how the step ended. When iterated through a `for-of` or `for-await-of`, an error thrown in the statement's block will take precedence and hide any error thrown during the disposal of the resource.

### `Disposable.usingFrom()`

```ts
/**
 * Wraps an iterable to ensure that iterated resources are disposed of
 */
interface DisposableUsingFrom {
  /**
   * @param disposables An iterable containing disposable resources over
   * which to iterate then dispose
   */
  <T extends Disposable>(disposables: Iterable<T>): Iterable<T>;

  /**
   * @param values - An iterable containing values over which to iterate
   * @param mapFn - A function returning a disposable resource from the
   * iterated value
   */
  <T>(values: Iterable<T>, mapFn: (value: T) => Disposable): Iterable<T>;
}
```

`Disposable.usingFrom()` can wrap any `Iterable`. The optional `mapFn` will be called for each iterated value and must return a _disposable_ resource.

### `AsyncDisposable.usingFrom()`

```ts
/**
 * Wraps an iterable or async iterable to ensure that iterated resources are
 * disposed of
 */
interface AsyncDisposableUsingFrom {
  /**
   * @param disposables - An iterable or async iterable containing disposable
   * or async disposable resources over which to iterate then dispose
   */
  <T extends Disposable | AsyncDisposable>(
    disposables: Iterable<T> | AsyncIterable<T>
  ): AsyncIterable<T>;

  /**
   * @param values - An iterable or async iterable containing values over which
   * to iterate
   * @param mapFn - A function returning a disposable or async disposable from
   * the iterated value
   */
  <T>(
    values: Iterable<T>,
    mapFn: (value: T) => Disposable | AsyncDisposable
  ): AsyncIterable<T>;
}
```

`AsyncDisposable.usingFrom()` can wrap any `Iterable` or `AsyncIterable`. The optional `mapFn` will be called for each iterated value and must return a _disposable_ or _async disposable_ resource.

### Examples

```js
for (const res of Disposable.usingFrom(iterateResources())) {
  // use res
}
```

```js
for (const value of Disposable.usingFrom(
  values,
  (value) => new Disposable(() => cleanup(value))
)) {
  // use value
}
```

```js
for await (const res of AsyncDisposable.usingFrom(iterateAsyncResources())) {
  // use res
}
```

```js
for await (const res of AsyncDisposable.usingFrom(asyncIterateResources())) {
  // use res
}
```

## `Disposable` and `AsyncDisposable` container objects

The package provides base classes implementing the `Disposable` and `AsyncDisposable` interfaces.

Their constructor creates a _disposable_ or _async disposable_ resource from a callback, which is called when the resource is disposed. This allows objects which don't implement the `Disposable` and `AsyncDisposable` interfaces to be used with the `using` and `usingFrom` helpers, or simply to register a callback when exiting a `using` iterator block.

The classes also have a static `from` method to create a `Disposable` or `AsyncDisposable` object which aggregates multiple _disposable_ or _async disposable_ resources, similarly to how the `using` helper aggregates multiple resources. The `from` static method eagerly consumes an iterable and adds its resources for tracking. The aggregated resources are disposed of in reverse order. If multiple resources are aggregated and any error is thrown during their disposal, an `AggregateError` is thrown when the aggregate object is disposed of. If any error occurs during construction, all iterated resources so far are automatically disposed of.

### `Disposable` constructor

```ts
interface DisposableConstructor {
  /**
   * Creates a disposable object aggregating multiple disposable resources
   *
   * @param disposables - An iterable containing resources to be disposed of
   * when the returned object is itself disposed of
   */
  from(disposables: Iterable<Disposable>): Disposable;

  /**
   * Creates a disposable object aggregating multiple disposable resources
   *
   * @param values - An iterable containing values for which the mapped
   * resource will be disposed of when the returned object is itself disposed of
   * @param mapFn - A function returning a disposable resource from the
   * iterated value
   */
  from<T>(values: Iterable<T>, mapFn: (value: T) => Disposable): Disposable;

  /**
   * Creates a disposable object from a simple callback
   *
   * @param onDispose - A callback to execute when this object is disposed of
   */
  new (onDispose: () => void): Disposable;
}
```

`Disposable.from()` consumes any `Iterable`. The optional `mapFn` will be called for each iterated value and must return a _disposable_ resource. It's used for aggregating the disposal of multiple resources.

`new Disposable()` requires a callback argument which will be called when the constructed _disposable_ object is disposed of. It's used to interoperate with resources which don't implement the `Disposable` interface.

### `AsyncDisposable` constructor

```ts
interface AsyncDisposableConstructor {
  /**
   * Creates an async disposable object aggregating multiple disposable or
   * async disposable resources
   *
   * @param disposables - An iterable or async iterable containing resources to
   * be disposed of when the returned object is itself disposed of
   */
  from(
    disposables:
      | Iterable<Disposable | AsyncDisposable>
      | AsyncIterable<Disposable | AsyncDisposable>
  ): Promise<AsyncDisposable>;

  /**
   * Creates an async disposable object aggregating multiple disposable or
   * async disposable resources
   *
   * @param values - An iterable or async iterable containing values for which
   * the mapped resource will be disposed of when the returned object is itself
   * disposed of
   * @param mapFn - A function returning a disposable or async disposable
   * resource from the iterated value
   */
  from<T>(
    values: Iterable<T> | AsyncIterable<T>,
    mapFn: (value: T) => Disposable | AsyncDisposable
  ): Promise<AsyncDisposable>;

  /**
   * Creates an async disposable object from a simple async callback
   *
   * @param onDispose - An async callback to execute when this object is
   * disposed of
   */
  new (onDispose: () => void | PromiseLike<void>);
}
```

`AsyncDisposable.from()` consumes any `Iterable` or `AsyncIterable`. The optional `mapFn` will be called for each iterated value and must return a _disposable_ or _async iterable_ resource. It's used for aggregating the disposal of multiple resources.

`new AsyncDisposable()` requires a callback argument which will be called and awaited when the constructed _async disposable_ object is disposed of. It's used to interoperate with resources which don't implement the `AsyncDisposable` interface.

### Examples

Working with existing resources that do not conform to the `Disposable` or `AsyncDisposable` interface:

```js
for await (const using of AsyncDisposable) {
  const reader = ...;
  using(new Disposable(() => reader.releaseLock()));
  ...
}
```

Schedule other cleanup work to evaluate at the end of the block similar to Go's `defer` statement:

```js
for (const using of Disposable) {
  console.log("enter");
  using(new Disposable(() => console.log("exit")));
  ...
}
```
