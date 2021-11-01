# Explicit Resource Management using `for-of`

This package provides an API inspired from the [Explicit Resource Management TC39 proposal](https://github.com/tc39/proposal-explicit-resource-management), leveraging the existing JavaScript semantics of `for-of` and `for-await-of`. It provides the same convenience of automatically disposing of resources when exiting a block, without requiring new syntax.

```js
import { Disposable } from "disposator";

for (const { using } of Disposable) {
  const resource = using(getResource());
  resource.doSomething();
  const other = using(resource.getOther());
  const stuff = other.doStuff();
  using(() => cleanUpStuff(stuff));
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

### functions as _disposable_

#### _disposable like_

A function can be used in places where a _disposable_ is expected. In that case the provided dispose function will simply be called, with no `this` context.

```ts
type OnDispose = () => void;
```

#### _async disposable like_

An async function can be used in places where an _async disposable_ is expected. In that case the provided dispose function will simply be called, with no `this` context, and the result will be awaited.

```ts
type OnAsyncDispose = () => void | PromiseLike<void>;
```

## Aggregate `Disposable` and `AsyncDisposable` objects

The package provides classes implementing the `Disposable` and `AsyncDisposable` interfaces allowing to wrap one or aggregate multiple _disposable like_ or _async disposable like_ resources. The resources can be added at construction and/or later using the aggregate object's `using` helper. The aggregated resources are disposed of in reverse order. If multiple resources are aggregated, any error thrown during their disposal are aggregated, and an `AggregateError` is thrown once all tracked resources have been disposed of. If any error occurs during construction (such as adding an invalid resource), all resources added are automatically disposed of.

Initial aggregated resources are added eagerly, either as multiple values passed to the constructor, or through an iterable provided to the static `from` method. The latter is preferred to create an aggregated object from initial resources, especially in the case of `AsyncDisposable`. With static `from`, resources are added for tracking as soon as they are iterated over, and any disposal error is merged with errors that triggered the construction-time disposal. Additionally the `from` helper optionally takes a mapping function similar to `Array.from()` allowing to reactively create during iteration a _disposable like_ or _async disposable like_ resource from any iterated value.

If the resources to aggregate are not all available at the same time, they can be added later with the `using` helper. If only a single resource needs to be in use while iterating over a collection, the `usingFrom` helper streamlines an acquire-use-dispose iteration.

### `Disposable` aggregate constructor

```ts
type DisposableResource = Disposable | OnAsyncDispose;

interface AggregateDisposableConstructor {
  /**
   * Creates a disposable object aggregating the given disposable resources
   *
   * @param disposables An iterable containing resources to be disposed of
   * when the returned object is itself disposed of
   */
  from(disposables: Iterable<DisposableResource>): AggregateDisposable;

  /**
   * Creates a disposable object aggregating the given disposable resources
   *
   * @param values An iterable containing values for which the mapped
   * resource will be disposed of when the returned object is itself disposed of
   * @param mapFn A function returning a disposable resource from the
   * iterated value
   */
  from<T>(
    values: Iterable<T>,
    mapFn: (value: T) => DisposableResource
  ): AggregateDisposable;

  /**
   * Creates an aggregate disposable object
   *
   * @param args Initial resources to add for tracking
   */
  new (...args: DisposableResource[]): AggregateDisposable;
}

export const Disposable: AggregateDisposableConstructor;
```

`Disposable.from()` consumes any `Iterable`. The optional `mapFn` will be called for each iterated value and must return a _disposable like_ resource.

`new Disposable()` accepts zero or any number of _disposable like_ resources.

### `AsyncDisposable` aggregate constructor

```ts
type AsyncDisposableResource = AsyncDisposable | Disposable | OnDispose;

interface AggregateAsyncDisposableConstructor {
  /**
   * Creates an async disposable object aggregating the given disposable or
   * async disposable resources
   *
   * @param disposables An iterable or async iterable containing resources to
   * be disposed of when the returned object is itself disposed of
   */
  from(
    disposables:
      | Iterable<AsyncDisposableResource>
      | AsyncIterable<AsyncDisposableResource>
  ): Promise<AggregateAsyncDisposable>;

  /**
   * Creates an async disposable object aggregating the given disposable or
   * async disposable resources
   *
   * @param values An iterable or async iterable containing values for which
   * the mapped resource will be disposed of when the returned object is itself
   * disposed of
   * @param mapFn A function returning a disposable or async disposable
   * resource from the iterated value
   */
  from<T>(
    values: Iterable<T> | AsyncIterable<T>,
    mapFn: (value: T) => AsyncDisposableResource
  ): Promise<AggregateAsyncDisposable>;

  /**
   * Creates an aggregate async disposable object
   *
   * Note: Prefer AsyncDisposable.from()
   * Any error adding the initial tracked resources may result in an unhandled
   * rejection resulting from the automatic disposal of the added resources
   *
   * @param args Initial resources to add for tracking
   */
  new (...args: AsyncDisposableResource[]): AggregateAsyncDisposable;
}

export const AsyncDisposable: AggregateAsyncDisposableConstructor;
```

`AsyncDisposable.from()` consumes any `Iterable` or `AsyncIterable`. The optional `mapFn` will be called for each iterated value and must return a _disposable like_ or _async iterable like_ resource.

`new AsyncDisposable()` accepts zero or any number of _disposable like_ or _async disposable like_ resources. If an error occurs while adding a resource for tracking, the resources added will be disposed and construction will throw. However any error occurring during this disposal will result in an unhandled rejection. To handle this case, prefer `AsyncDisposable.from()`.

### `using` helper: add resources for tracking

The `AggregateDisposable` and `AggregateAsyncDisposable` objects expose a `using` helper on their instance which can be used to add resources for tracking after construction of the aggregate object. The `using` helper can be detached from the aggregate object (it's bound at construction). Calling `using` after the aggregate has been disposed throws an error. It passes through its value for chaining, or assignment at acquisition time. `using` accepts a dispose callback function as an optional argument. This can be used to implement disposal for values which do not implement the disposables interfaces. In that case the value is passed as `this` context to the dispose callback

#### Aggregate `Disposable`

```ts
interface AggregateDisposable extends Disposable {
  /**
   * Helper adding new resources to track in the aggregated disposable.
   * The helper can be detached
   */
  readonly using: AggregateDisposableUsing;
}

/**
 * Add a disposable resource for tracking
 */
interface AggregateDisposableUsing {
  /**
   * @param disposable The disposable resource to track
   * @returns The disposable resource
   */
  <T extends DisposableResource>(disposable: T): T;

  /**
   * @param value A value to consider as a resource to dispose
   * @param onDispose The dispose callback invoked with the value
   * as `this` context
   * @returns The value
   */
  <T>(value: T, onDispose: OnDispose): T;
}
```

The `Disposable`'s `using` helper function can be used to track any _disposable like_ resource. It captures the _disposable_ and its dispose method, or the dispose callback, then passes through the value. Additionally `using` can be called with an `onDispose` callback as second argument, which will be called with the value as `this` context. When the aggregate object is disposed of, the tracked resources are disposed of in reverse order to which they were added.

#### Aggregate `AsyncDisposable`

```ts
interface AggregateAsyncDisposable extends AsyncDisposable {
  /**
   * Helper adding new resources to track in the aggregated async disposable.
   * The helper can be detached
   */
  readonly using: AggregateAsyncDisposableUsing;
}

/**
 * Add a disposable or async disposable resource for tracking
 */
interface AggregateAsyncDisposableUsing {
  /**
   * @param disposable The disposable or async disposable resource to track
   * @returns The disposable or async disposable resource
   */
  <T extends AsyncDisposableResource>(disposable: T): T;

  /**
   * @param value A value to consider as a resource to dispose
   * @param onDispose The async dispose callback invoked with the value
   *  as `this` context
   * @returns The value
   */
  <T>(value: T, onDispose: OnAsyncDispose): T;
}
```

The `AsyncDisposable`'s `using` helper function can be used to track any _disposable_ or _async disposable like_ resource. It captures the _disposable_ and its dispose method, the _async disposable_ and its async dispose method, or the async dispose callback, then passes through the value. Additionally `using` can be called with an `onDispose` async callback as second argument, which will be called with the value as `this` context. When the aggregate async object is disposed of, the tracked resources are disposed of in reverse order to which they were added.

The disposal of an _async disposable like_ resource is awaited before moving to the next resource. The disposal of a _disposable_ resource is not awaited. The aggregate disposal step is always awaited even if all tracked resources are _disposable_ which are disposed of synchronously.

## Aggregate disposable iterator helpers

### Multiple resource iterator helper

The `Disposable` and `AsyncDisposable` exports both implement a special iterator helper which streamlines creating an aggregated resource object and disposing of resources added for tracking. While these iterators only ever yield a single value (the aggregate object), they are meant to be used with respectively the `for-of` and `for-await-of` statements which automatically closes their iterator in case of an early return or thrown error. The iterator's close triggers the disposal of the aggregate object and the resources it tracks.

Combined with the detachable `using` helper of the aggregate object, it allows seamlessly tracking multiple _disposable like_ or _async disposable like_ resources and ensuring that they are properly disposed of when exiting a scope block, without dealing directly with the aggregate object itself.

If the disposal of the aggregate resource was triggered by an error thrown during the evaluation of the `for-of` or `for-await-of` block, that error takes precedence and errors occurring during the disposal are ignored. This is unlike `try-finally` statements where an error during the `finally` block takes precedence over the `try` block.

#### `for (const { using } of Disposable)`

```ts
interface AggregateDisposableConstructor {
  /**
   * Returns an iterator which yields a new aggregate instance. Its `using`
   * helper can be used to track disposable resources which will be disposed
   * of when the iterator is closed. Use with a `for-of` statement to perform
   * RAII style explicit resource management
   */
  [Symbol.iterator](): IterableIterator<AggregateDisposable>;
}
```

When the iterator closes, either from an early return, thrown error, or once the block completes, the aggregate object disposes of its tracked resources in reverse order to which they were added.

#### `for await (const { using } of AsyncDisposable)`

```ts
interface AggregateAsyncDisposableConstructor {
  /**
   * Returns an async iterator which yields a new async aggregate instance.
   * Its `using` helper can be used to track disposable or async disposable
   * resources which will be disposed of when the iterator is closed. Use
   * with a `for-await-of` statement to perform RAII style explicit resource
   * management
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<AggregateAsyncDisposable>;
}
```

When the iterator closes, either from an early return, thrown error, or once the block completes, the async aggregate object disposes of its tracked resources in reverse order to which they were added.

#### Examples

The following show examples of using the iterator helper with various APIs, assuming those APIs implement the _disposable_ or _async disposable_ interfaces.

**WHATWG Streams Reader API**

```js
for await (const { using } of AsyncDisposable) {
  const reader = using(stream.getReader());
  const { value, done } = await reader.read();
}
```

**NodeJS FileHandle**

```js
for await (const { using } of AsyncDisposable) {
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
for await (const { using } of AsyncDisposable) {
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
  for (const { using } of Disposable) {
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
  for (const { using } of Disposable) {
    using(await sem.wait()); // asynchronously block until we are the sole participant
    ...
  } // synchronously release semaphore and notify the next participant
}
```

The following show examples of integrating with API which do not implement the `Disposable` or `AsyncDisposable` interface\*\*

**Working with existing resources**

```js
for await (const { using } of AsyncDisposable) {
  const reader = ...;
  using(() => reader.releaseLock());
  ...
}
```

**Schedule other cleanup work to evaluate at the end of the block similar to Go's `defer` statement**

```js
for (const { using } of Disposable) {
  console.log("enter");
  using(() => console.log("exit"));
  ...
}
```

### Single resource iterator helper

For the case where only a single _disposable_ or _async disposable_ resource needs to be tracked, the `Disposable.using()` and `AsyncDisposable.using()` helpers can be used instead. The iterator yields a single value, the resource itself, and disposes of it when the iterator is closed. The iterators are meant to be used with respectively the `for-of` and `for-await-of` statements which automatically closes their iterator in case of an early return or thrown error.

#### `for (const res of Disposable.using(getResource()))`

```ts
interface AggregateDisposableConstructor {
  /**
   * Returns an iterator which yields the provided disposable resource, and
   * disposes of the resource at close. Use with a `for-of` statement to
   * ensure the iterator is closed and the resource disposed of after usage.
   *
   * @param disposable The disposable resource to track
   */
  using<T extends DisposableResource>(disposable: T): IterableIterator<T>;

  /**
   * Returns an iterator which yields the provided resource, and disposes of
   * the resource with the specified dispose callback at close. Use with a
   * `for-of` statement to ensure the iterator is closed and the resource
   * disposed of after usage.
   *
   * @param value A value to consider as a resource to dispose
   * @param onDispose The dispose callback invoked with the value
   * as `this` context
   */
  using<T>(value: T, onDispose: OnDispose): IterableIterator<T>;
}
```

The `using` helper captures the _disposable_ and its dispose method, or the resource and the dispose callback. When the returned iterator closes, either from an early return, thrown error, or once the block completes, the iterator disposes of the tracked resource. If an optional `onDispose` callback is provided, it's called with the resource value as `this` context.

#### `for await (const res of AsyncDisposable.using(getResource()))`

```ts
interface AggregateAsyncDisposableConstructor {
  /**
   * Returns an async iterator which yields the provided async disposable
   * resource, and disposes of the resource at close. Use with a
   * `for-await-of` statement to ensure the iterator is closed and the
   * resource disposed of after usage.
   *
   * @param disposable The disposable resource to track
   */
  using<T extends AsyncDisposableResource>(
    disposable: T
  ): AsyncIterableIterator<T>;

  /**
   * Returns an async iterator which yields the provided resource, and
   * disposes of the resource with the specified async dispose callback at
   * close. Use with a `for-await-of` statement to ensure the iterator is
   * closed and the resource disposed of after usage.
   *
   * @param value A value to consider as a resource to dispose
   * @param onDispose The async dispose callback invoked with the value
   * as `this` context
   */
  using<T>(value: T, onDispose: OnAsyncDispose): AsyncIterableIterator<T>;
}
```

The `using` helper captures the _async disposable_ and its dispose method, or the resource and the dispose async callback. When the returned iterator closes, either from an early return, thrown error, or once the block completes, the iterator disposes of the tracked resource. If an optional `onDispose` async callback is provided, it's called with the resource value as `this` context.

## `usingFrom`: iterable of _disposable_

The `Disposable.usingFrom()` and `AsyncDisposable.usingFrom()` helpers streamline iterating over resources, ensuring that each iterated resource is disposed of before acquiring the next resource. They do not dispose of resources that are not iterated over, e.g. if the iteration is terminated early.

The helpers works by generating a new iterable which captures a provided iterable, and an optional `mapFn` function. When an iterator is subsequently requested, the captured iterable's iterator is requested and wrapped. For each iteration, the iterator requests the next value from the wrapped iterator, tracks the resource, then yields the value. The optional `mapFn` function can be used to generate a _disposable_ or _async disposable_ resource from the iterated value.

After each iteration step, the resource is disposed of, regardless of how the step ended. When iterated through a `for-of` or `for-await-of`, an error thrown in the statement's block will take precedence and hide any error thrown during the disposal of the resource.

### `Disposable.usingFrom()`

```ts
interface AggregateDisposableConstructor {
  /**
   * Wraps an iterable to ensure that iterated resources are disposed of
   *
   * @param disposables An iterable containing disposable resources over
   * which to iterate then dispose
   */
  usingFrom<T extends DisposableResource>(
    disposables: Iterable<T>
  ): Iterable<T>;

  /**
   * Wraps an iterable to ensure that iterated resources are disposed of
   *
   * @param values An iterable containing values over which to iterate
   * @param mapFn A function returning a disposable resource from the
   * iterated value
   */
  usingFrom<T>(
    values: Iterable<T>,
    mapFn: (value: T) => DisposableResource
  ): Iterable<T>;
}
```

`Disposable.usingFrom()` can wrap any `Iterable`. The optional `mapFn` will be called for each iterated value and must return a _disposable like_ resource.

### `AsyncDisposable.usingFrom()`

```ts
interface AggregateAsyncDisposableConstructor {
  /**
   * Wraps an iterable or async iterable to ensure that iterated resources are
   * disposed of
   *
   * @param disposables An iterable or async iterable containing disposable
   * or async disposable resources over which to iterate then dispose
   */
  usingFrom<T extends AsyncDisposableResource>(
    disposables: Iterable<T> | AsyncIterable<T>
  ): AsyncIterable<T>;

  /**
   * Wraps an iterable or async iterable to ensure that iterated resources are
   * disposed of
   *
   * @param values An iterable or async iterable containing values over which
   * to iterate
   * @param mapFn A function returning a disposable or async disposable
   * resource from the iterated value
   */
  usingFrom<T>(
    values: Iterable<T> | AsyncIterable<T>,
    mapFn: (value: T) => AsyncDisposableResource
  ): AsyncIterable<T>;
}
```

`AsyncDisposable.usingFrom()` can wrap any `Iterable` or `AsyncIterable`. The optional `mapFn` will be called for each iterated value and must return a _disposable_ or _async disposable like_ resource.

### Examples

```js
for (const res of Disposable.usingFrom(iterateResources())) {
  // use res
}
```

```js
for (const value of Disposable.usingFrom(
  values,
  (value) => () => cleanup(value)
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
