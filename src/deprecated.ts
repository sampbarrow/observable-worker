
import pDefer from "p-defer"
import PLazy from "p-lazy"
import { BehaviorSubject, EMPTY, Observable, ObservableNotification, ReplaySubject, Subject, Subscription, catchError, combineLatest, concatWith, defer, dematerialize, filter, finalize, first, firstValueFrom, from, fromEvent, ignoreElements, isObservable, map, materialize, merge, mergeMap, of, share, shareReplay, startWith, switchMap, takeUntil, tap, throwError } from "rxjs"
import { HasEventTargetAddRemove } from "rxjs/internal/observable/fromEvent"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { Batcher, BatcherOptions } from "./batcher"
import { ObservableAndPromise, generateId } from "./wrap"

/**
 * A channel creates Connection objects.
 */
type Channel<I, O> = () => Connection<I, O>

namespace Channel {

    /**
     * A pre-created channel from this window's globalThis.
     */
    export const SELF = port(globalThis)

    /**
     * Wraps another channel and batches any messages sent to it. Also treats incoming messages as batches.
     */
    export function batching<I, O>(channel: Channel<readonly I[], readonly O[]>, options?: BatcherOptions<any> | undefined) {
        return () => {
            const connection = channel()
            const batcher = new Batcher<O>(connection.next.bind(connection), options)
            return Connection.from<I, O>({
                observable: connection.pipe(mergeMap(items => items)),
                next: batcher.add.bind(batcher),
                close: () => {
                    batcher.process()
                    connection.close()
                }
            })
        }
    }

    export function logging<I, O>(channel: Channel<I, O>, name: string = "Untitled") {
        return () => {
            const connection = channel()
            return Connection.from<I, O>({
                observable: connection.pipe(tap(emission => console.log("Received emission on channel " + name + ".", emission))),
                next: value => {
                    console.log("Sending emission on channel " + name + ".", value)
                    connection.next(value)
                },
                close: connection.close,
            })
        }
    }

    /**
     * A broadcast channel.
     * @param name The name of the channel.
     * @returns A channel.
     */
    export function broadcast<I, O>(name: string): Channel<I, O> {
        return port(() => new BroadcastChannel(name), channel => channel.close())
    }

    /**
     * A two way port.
     */
    export type Port<I, O> = HasEventTargetAddRemove<MessageEvent<I>> & { postMessage(value: O): void }

    /**
     * TODO closing is weird
     * if we want to just close the sender, we have to leave the channel open so we can unsubscribe from everything
     * 
     */
    export function port<T extends Port<I, O>, I = never, O = unknown>(open: ValueOrFactory<T, []>, close?: ((port: T) => void) | undefined) {
        return () => {
            const connection = callOrGet(open)
            const closed = new BehaviorSubject(false)
            return Connection.from<I, O>({
                observable: fromEvent(connection, "message").pipe(map(event => event.data), takeUntil(closed.pipe(filter(closed => closed)))),
                next: value => {
                    if (closed.getValue()) {
                        throw new Error("This channel is closed.")
                    }
                    connection.postMessage(value)
                },
                close: () => {
                    closed.next(true)
                    closed.complete()
                    if (close !== undefined) {
                        close(connection)
                    }
                }
            })
        }
    }

}

namespace Connection {

    export interface From<I, O> {

        readonly observable: Observable<I>
        next(value: O): void
        close(): void

    }

}

class Connection<I, O> extends Observable<I> {

    constructor(observable: Observable<I>, private readonly observer: (value: O) => void, readonly close: () => void = () => void 0) {
        super(subscriber => {
            return observable.subscribe(subscriber)
        })
    }

    next(value: O) {
        return this.observer(value)
    }

    /**
     * Combine and observable and observer into a channel.
     */
    static from<I, O>(from: Connection.From<I, O>): Connection<I, O> {
        return new Connection(from.observable, from.next, from.close)
    }

}
type Answer = ObservableNotification<ObservableNotification<unknown> & { readonly id: ID }>

export interface ChannelSenderOptions {

    readonly channel: Channel<ObservableNotification<Answer>, Request>

}

export class ChannelSender implements Sender {

    private readonly closed = new Subject<void>()
    private readonly channel

    constructor(private readonly config: ChannelSenderOptions) {
        this.channel = config.channel()
    }

    close() {
        this.closed.complete()
        this.channel.close()
    }

    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown> {
        const channel = merge(
            of(this.channel),
            this.closed.pipe(concatWith(throwError(() => new Error("This remote is closed.")))).pipe(ignoreElements())
        )
        const observable = channel.pipe(
            switchMap(connection => {
                const id = generateId()
                const observable = connection.pipe(
                    finalize(() => {
                        connection.next({
                            kind: "unsubscribe",
                            id
                        })
                    }),
                    dematerialize(),
                    answer(id, command),
                )
                connection.next({
                    kind: "subscribe",
                    id,
                    command,
                    data,
                })
                return observable
            })
        )
        const promise = PLazy.from(async () => {
            return await firstValueFrom(channel.pipe(
                switchMap(connection => {
                    const id = generateId()
                    const observable = connection.pipe(
                        dematerialize(),
                        answer(id, command),
                    )
                    connection.next({
                        kind: "execute" as const,
                        id,
                        command,
                        data
                    })
                    return observable
                })
            ))
        })
        return new ObservableAndPromise(observable, promise)
    }

}

/*
function answer(id: ID, command: string, ackTimeout?: number | undefined) {
    return (observable: Observable<Answer>) => {
        return observable.pipe(
            mergeMap(answer => {
                if (answer.id === id) {
                    return of(answer)
                }
                return EMPTY
            }),
            dematerialize(),
        )
    }
}
*/

export interface VolatileRemote<T extends Target> {

    /**
     * The proxied object.
     */
    readonly proxy: Proxied<T>

    /**
     * Watch for a new proxied object.
     * @deprecated
     * @param autoReconnect 
     */
    watch(autoReconnect?: boolean | undefined): Observable<Proxied<T>>

    /**
     * Close this channel.
     */
    close(): void

}

export interface VolatileSender extends Sender {

    /**
     * Watch this for individual senders when a new connection is made.
     */
    watch(autoReconnect?: boolean | undefined): Observable<Sender>

}

export interface Callable {

    /**
     * Call a command on the remote.
     * @param command Command name.
     * @param data Arguments in an array.
     */
    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown>

}

/**
 * The frontend object that translates calls to messages and sends them over a connection.
 */
export interface Sender extends Callable {

    /**
     * Close this sender and disconnect from the remote.
     */
    close(): void

}

export class VolatileSenderRemote<T extends Target> implements VolatileRemote<T> {

    readonly proxy

    constructor(private readonly sender: VolatileSender) {
        this.proxy = oldProxy<T>(this.sender)
    }

    watch(autoReconnect?: boolean | undefined) {
        return this.sender.watch(autoReconnect).pipe(map(sender => oldProxy<T>(sender)))
    }
    close() {
        return this.sender.close()
    }

}

export function oldProxy<T extends Target>(sender: Callable) {
    return new Proxy(sender, {
        get(target, key) {
            if (typeof key === "symbol") {
                throw new Error("No symbol calls on a proxy.")
            }
            return (...args: unknown[]) => target.call(key, ...args)
        }
    }) as unknown as Proxied<T>
}

/**
 * A deferred observable that performs a cleanup action on unsubscribe.
 * @deprecated
 */
export function closing<T>(factory: () => T, close: (value: T) => void) {
    return new Observable<T>(subscriber => {
        const value = factory()
        subscriber.next(value)
        return () => {
            close(value)
        }
    })
}

namespace OldChannel {

    //TODO rm

    /**
     * Creates a channel from a port.
     */
    export function oldPort<I = never, O = unknown>(open: Observable<Channel.Port<I, O>>): OldChannel<I, O> {
        return new Observable<Connection<I, O>>(subscriber => {
            const subscription = open.subscribe(object => {
                subscriber.next(Connection.from({
                    observable: fromEvent<MessageEvent<I>>(object, "message").pipe(map(_ => _.data)),
                    next: value => {
                        try {
                            object.postMessage(value)
                        }
                        catch (e) {
                            console.error(e)
                            subscriber.error(e)
                        }
                    },
                    close: () => void 0,
                }))
            })
            return () => {
                subscription.unsubscribe()
            }
        })
    }

    /**
     * Creates a channel from a broadcast channel.
     */
    export function oldBroadcast<T>(name: string): OldChannel<T, T> {
        return oldPort(closing(() => new BroadcastChannel(name), channel => () => channel.close()))
    }
    /*
    export function broadcast2<T>(name: string): Channel<T, T> {
        const channel = new BroadcastChannel(name)
        return {
            channel,
            close: () => channel.close(),
        }
    }
    */

    /**
     * Creates a channel from a two broadcast channels, one for input and one for output.
     */
    export function oldDualBroadcast<I, O>(input: string, output: string): OldChannel<I, O> {
        return combineLatest([oldBroadcast<I>(input), oldBroadcast<O>(output)]).pipe(map(([a, b]) => Connection.from({ observable: a, next: b.next.bind(b), close: b.close })))
    }

    /**
     * Creates a channel from a worker.
     */
    export function oldWorker<I, O>(url: string | URL, options?: WorkerOptions | undefined): OldChannel<I, O> {
        return oldPort(closing(() => new Worker(url, options), worker => worker.terminate()))
    }

    export function unbatching<I, O>(channel: OldChannel<readonly I[], readonly O[]>) {
        return channel.pipe(
            map(connection => {
                return Connection.from<I, O>({ observable: connection.pipe(mergeMap(items => items)), next: value => connection.next([value]), close: () => void 0 })
            })
        )
    }

    /**
     * Wraps another channel and batches any messages sent to it. Also treats incoming messages as batches.
     */
    export function batchingOld<I, O>(channel: OldChannel<readonly I[], readonly O[]>, options?: BatcherOptions<any> | undefined) {
        return channel.pipe(
            map(connection => {
                const batcher = new Batcher<O>(connection.next.bind(connection), options)
                return Connection.from<I, O>({
                    observable: connection.pipe(mergeMap(items => items)),
                    next: v => {
                        batcher.add(v)
                    },
                    close: () => void 0,
                })
            })
        )
    }
}

export type Finder = ChannelFactory<ObservableNotification<Answer>, Request>
export type Advertiser = Observable<RegistryAction<string, Connection<Request, ObservableNotification<Answer>>>>

export const DEFAULT_CONTEXT = "default"

export interface BroadcastCoordinatorOptions {

    readonly context?: string

}

export type RegistryAction<K, V> = {

    readonly action: "add"
    readonly key: K
    readonly observable: Observable<V>

} | {

    readonly action: "delete"
    readonly key: K

} | {

    readonly action: "clear"

}

/**
 * An observable that combines other observables, but also allows removing them.
 */
export function registry<K, V>(observable: Observable<RegistryAction<K, V>>) {
    const observables = new Map<K, Subscription>()
    return observable.pipe(
        mergeMap(action => {
            if (action.action === "add") {
                return new Observable<readonly [V, K]>(subscriber => {
                    const subscription = action.observable.pipe(map(value => [value, action.key] as const)).subscribe(subscriber)
                    observables.set(action.key, subscription)
                    return () => {
                        subscription.unsubscribe()
                        observables.delete(action.key)
                    }
                })
            }
            else if (action.action === "clear") {
                observables.forEach(subscription => {
                    subscription.unsubscribe()
                })
                return EMPTY
            }
            else {
                const observable = observables.get(action.key)
                if (observable !== undefined) {
                    observable.unsubscribe()
                }
                return EMPTY
            }
        }),
        finalize(() => {
            observables.forEach(observable => observable.unsubscribe())
            observables.clear()
        }),
    )
}

export function broadcastFinder(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastFinder(options.context ?? DEFAULT_CONTEXT, (id1, id2) => OldChannel.oldDualBroadcast(id1, id2))
}
export function broadcastAdvertiser(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastAdvertiser(options.context ?? DEFAULT_CONTEXT, (id1, id2) => OldChannel.oldDualBroadcast(id1, id2))
}

export interface BroadcastCoordinatorBatchingOptions {

    readonly context?: string | undefined
    readonly batcher?: BatcherOptions<any> | undefined

}

export function broadcastFinderBatching(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastFinder(options.context ?? DEFAULT_CONTEXT, (id1, id2) => OldChannel.batchingOld(OldChannel.oldDualBroadcast(id1, id2)))
}
export function broadcastAdvertiserBatching(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastAdvertiser(options.context ?? DEFAULT_CONTEXT, (id1, id2) => OldChannel.batchingOld(OldChannel.oldDualBroadcast(id1, id2)))
}
export function broadcastAdvertiserBatching2(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastAdvertiser(options.context ?? DEFAULT_CONTEXT, (id1, id2) => OldChannel.batchingOld(OldChannel.oldDualBroadcast(id1, id2)))
}

type BroadcastChannelCreator = <I, O>(id1: string, id2: string) => OldChannel<I, O>

function buildBroadcastAdvertiser(context: string, createBroadcastChannel: BroadcastChannelCreator) {
    return observeWebLock(context).pipe(
        switchMap(() => {
            const registrationChannelId = generateId()
            const registration = OldChannel.oldBroadcast<RegistrationMessage>(registrationChannelId)
            return merge(
                combineLatest([
                    OldChannel.oldBroadcast<LookupMessage>(context),
                    observeRandomWebLock()
                ]).pipe(
                    switchMap(([lookupConnection, lockId]) => {
                        return lookupConnection.pipe(
                            filter(message => message.type === "askIfWorkerIsAvailable"),
                            map(() => {
                                return {
                                    type: "workerIsAvailable" as const,
                                    registrationChannelId,
                                    lockId
                                }
                            }),
                            startWith({
                                type: "newWorkerStarted" as const,
                                registrationChannelId,
                                lockId
                            }),
                            tap(lookupConnection)
                        )
                    }),
                    ignoreElements()
                ),
                registration.pipe(
                    switchMap(connection => {
                        return connection.pipe(
                            mergeMap(message => message.type === "registerClient" ? of(message) : EMPTY),
                            mergeMap(message => {
                                connection.next({
                                    type: "clientRegistered",
                                    clientId: message.clientId
                                })
                                const lock = waitForLock(message.lockId)
                                return merge(
                                    of({
                                        action: "add" as const,
                                        key: message.clientId,
                                        observable: createBroadcastChannel<Request, ObservableNotification<Answer>>(message.callChannelId, message.answerChannelId)
                                    }),
                                    from(lock).pipe(
                                        map(() => {
                                            return {
                                                action: "delete" as const,
                                                key: message.clientId
                                            }
                                        })
                                    )
                                )
                            })
                        )
                    })
                )
            )
        })
    )
}

function buildBroadcastFinder(context: string, createBroadcastChannel: BroadcastChannelCreator): ChannelFactory<ObservableNotification<Answer>, Request> {
    return OldChannel.oldBroadcast<LookupMessage>(context).pipe(
        switchMap(lookup => {
            lookup.next({
                type: "askIfWorkerIsAvailable"
            })
            return lookup.pipe(
                mergeMap(message => message.type === "newWorkerStarted" || message.type === "workerIsAvailable" ? of(message) : EMPTY),
                first(),
                switchMap(message => {
                    return merge(
                        of(message),
                        lookup.pipe(mergeMap(message => message.type === "newWorkerStarted" ? of(message) : EMPTY))
                    )
                }),
                switchMap(server => {
                    return observeRandomWebLock().pipe(
                        switchMap(lockId => {
                            const registration = OldChannel.oldBroadcast<RegistrationMessage>(server.registrationChannelId)
                            return registration.pipe(
                                switchMap(registration => {
                                    const clientId = generateId()
                                    const callChannelId = generateId()
                                    const answerChannelId = generateId()
                                    registration.next({
                                        type: "registerClient",
                                        clientId,
                                        lockId,
                                        callChannelId,
                                        answerChannelId,
                                    })
                                    return registration.pipe(
                                        filter(message => message.type === "clientRegistered" && message.clientId === clientId),
                                        first(),
                                        map(() => {
                                            return createBroadcastChannel<ObservableNotification<Answer>, Request>(answerChannelId, callChannelId).pipe(
                                                takeUntil(waitForLock(server.lockId)),
                                                shareReplay(1)
                                                //TODO adding this fixed a bug where responses would get duplicated 50+ times
                                                //makes some kind of sense, but look into this a bit more to make sure best practices are being followed, here and in similar areas
                                                //looks like it still might be doing this to some extent, just not as bad, could be dropped due to refCount?
                                            )
                                        })
                                    )
                                })
                            )
                        }),
                    )
                })
            )
        })
    )
}

/**
 * Lookup
 */

type LookupMessage = AskIfWorkerIsAvailableMessage | NewWorkerStartedMessage | WorkerIsAvailableMessage

type AskIfWorkerIsAvailableMessage = {
    readonly type: "askIfWorkerIsAvailable"
}

type NewWorkerStartedMessage = {
    readonly type: "newWorkerStarted"
    readonly registrationChannelId: string
    readonly lockId: string
}

type WorkerIsAvailableMessage = {
    readonly type: "workerIsAvailable"
    readonly registrationChannelId: string
    readonly lockId: string
}

type RegistrationMessage = RegisterClientMessage | ClientRegisteredMessage

type RegisterClientMessage = {
    readonly type: "registerClient"
    readonly clientId: string
    readonly lockId: string
    readonly callChannelId: string
    readonly answerChannelId: string
}

type ClientRegisteredMessage = {
    readonly type: "clientRegistered"
    readonly clientId: string
}

/**
 * A hack function to acquire a web lock and hold onto it.
 */
export async function acquireWebLock(name: string, options?: LockOptions) {
    return new Promise<() => void>((resolve, reject) => {
        navigator.locks.request(name, options ?? {}, () => {
            const defer = pDefer<void>()
            resolve(defer.resolve)
            return defer.promise
        }).catch(e => {
            reject(e)
        })
    })
}

export async function waitForLock(name: string): Promise<void> {
    try {
        return await navigator.locks.request(name, { mode: "shared" }, async () => void 0)
    }
    catch (error) {
        //TODO code is deprecated, whats the alternative
        if (error instanceof DOMException && error.code === error.ABORT_ERR) {
            return
        }
        throw error
    }
}

/**
 * Acquire a web lock as an observable. Releases when unsubscribed.
 */
export function observeWebLock(name: string, options?: Omit<LockOptions, "signal">) {
    return new Observable<void>(subscriber => {
        const controller = new AbortController()
        const lock = acquireWebLock(name, { ...options, signal: controller.signal })
        lock.then(() => subscriber.next()).catch(error => {
            if (error instanceof DOMException && error.code === error.ABORT_ERR) {
                return
            }
            subscriber.error(error)
        })
        return () => {
            controller.abort()
            lock.then(release => release())
        }
    })
}

/**
 * A hack function to acquire a randomly named web lock as an observable. Releases when unsubscribed.
 */
export function observeRandomWebLock(tag: string = "") {
    return defer(() => {
        const lockId = tag + generateId()
        return observeWebLock(lockId).pipe(map(() => lockId))
    })
}

export interface VolatileChannelSenderOptions {

    readonly channel: ChannelFactory<ObservableNotification<Answer>, Request>

}

export function withVolatility<I, O>(retryOnInterrupt: boolean) {
    return (observable: ChannelFactory<I, O>) => {
        if (retryOnInterrupt) {
            return observable //TODO timeout somehow
        }
        return observable.pipe(
            map(observable => {
                return observable.pipe(concatWith(throwError(() => new RemoteError("worker-disappeared", "The worker disappeared. Please try again."))))
            })
        )
    }
}

/**
 * A channel creates Connection objects. We use an observable for this so that channels can manage opening and closing via subscribe and unsubscribe.
 */
export interface OldChannel<I, O> extends Observable<Connection<I, O>> {
}

/**
 * A channel factory creates channels.
 */
export interface ChannelFactory<I, O> extends Observable<OldChannel<I, O>> {
}

export class VolatileChannelSender implements Sender {

    private readonly closed = new BehaviorSubject(false)
    private readonly channel

    constructor(private readonly config: VolatileChannelSenderOptions) {
        this.channel = this.closed.pipe(
            switchMap(closed => {
                if (closed) {
                    return throwError(() => new Error("This remote is closed."))
                }
                return config.channel
            }),
            share({
                connector: () => new ReplaySubject(1),
                resetOnRefCountZero: false,
                resetOnComplete: false,
                resetOnError: true,
            })
        )
    }

    watch(autoReconnect = true) {
        return this.channel.pipe(
            withVolatility(autoReconnect),
            map(channel => {
                return new VolatileChannelSender({ ...this.config, channel: of(channel) })
            })
        )
    }
    close() {
        this.closed.next(true)
        this.closed.complete()
    }
    withOptions(options: {}) {
        return new VolatileChannelSender({ ...this.config, ...options, channel: this.channel })
    }

    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown> {
        const observable = this.channel.pipe(
            withVolatility(true),
            switchMap(_ => _),
            switchMap(connection => {
                const id = generateId()
                const send = {
                    kind: "subscribe" as const,
                    id,
                    command,
                    data,
                }
                connection.next(send)
                return connection.pipe(
                    finalize(() => {
                        //TODO how do we make it so this only issues if the inner observable is unsubscribed from directly?
                        //if the channel closes, this fails - its not necessary in that case
                        connection.next({
                            kind: "unsubscribe",
                            id
                        })
                    }),
                    dematerialize(),
                    answer(id, command, 10000000),
                )
            })
        )
        const promise = PLazy.from(async () => {
            return await firstValueFrom(this.channel.pipe(
                withVolatility(false),
                switchMap(_ => _),
                switchMap(connection => {
                    const id = generateId()
                    const send = {
                        kind: "execute" as const,
                        id,
                        command,
                        data
                    }
                    const observable = connection.pipe(
                        dematerialize(),
                        answer(id, command, 10000000)
                    )
                    connection.next(send)
                    return observable
                })
            ))
        })
        return new ObservableAndPromise(observable, promise)
    }

}

function answer(id: ID, command: string, ackTimeout?: number | undefined) {
    return (observable: Observable<Answer>) => {
        return observable.pipe(
            dematerialize(),
            mergeMap(answer => {
                if (answer.id === id) {
                    return of(answer)
                }
                return EMPTY
            }),
            dematerialize(),
        )
        /*
        return merge(
            observable.pipe(
                mergeMap(answer => {
                        if (answer.id === id) {
                            return of(answer.response)
                        }
                    return EMPTY
                }),
                dematerialize(),
            ),
            (() => {
                if (ackTimeout !== undefined) {
                    return observable.pipe(
                        mergeMap(answer => {
                            if (answer.kind === "A") {
                                if (answer.id === id) {
                                    return of(void 0)
                                }
                            }
                            return EMPTY
                        }),
                        timeout({
                            first: ackTimeout,
                            with: () => {
                                return throwError(() => new RemoteError("timeout", "The remote call to \"" + command + "\" was not acknowledged within " + ackTimeout.toLocaleString() + "ms."))
                            }
                        }),
                        ignoreElements()
                    )
                }
                else {
                    return EMPTY
                }
            })()
        )*/
    }
}

interface ExposeMigratingConfig<T extends Target> {

    readonly advertiser: Advertiser
    readonly target: ValueOrFactory<T, [unknown]>

}

export function exposeMigrating<T extends Target>(config: ExposeMigratingConfig<T>) {
    return registry(config.advertiser.pipe(
        map(action => {
            if (action.action === "add") {
                return {
                    ...action,
                    observable: new Observable<void>(s => {
                        const x = expose({
                            channel: action.observable,
                            target: callOrGet(config.target, action.key)
                        })
                        return x
                    })
                }
            }
            return action
        }),
    )).subscribe()
}

export interface WrapMigratingConfig {

    readonly finder: Finder

}

export function wrapMigrating<T extends Target>(config: WrapMigratingConfig) {
    return wrapVolatile<T>({
        channel: config.finder,
    })
}


export interface WrapVolatileOptions extends VolatileChannelSenderOptions {
}

export function wrapVolatile<T extends Target>(options: WrapVolatileOptions): VolatileRemote<T> {
    return new VolatileSenderRemote<T>(new VolatileChannelSender(options))
}

interface ExposeConfig<T extends Target> {

    readonly target: T
    readonly channel: OldChannel<Request, ObservableNotification<Answer>>

}

function expose<T extends Target>(config: ExposeConfig<T>) {
    const subscription = config.channel.pipe(
        switchMap(connection => {
            return connection.pipe(
                mergeMap(req => {
                    if (req.kind === "unsubscribe") {
                        return of({
                            action: "delete" as const,
                            key: req.id
                        })
                    }
                    else {
                        const observable = defer(() => {
                            const input = call(config.target, req.command, req.data)
                            if (req.kind === "subscribe") {
                                if (typeof input === "function") {
                                    throw new RemoteError("invalid-message", "Trying to treat a promise as an observable.")
                                }
                                else {
                                    return input
                                }
                            }
                            else {
                                if (typeof input === "object") {
                                    throw new RemoteError("invalid-message", "Trying to treat an observable as a promise.")
                                }
                                else {
                                    return defer(input)
                                }
                            }
                        })
                        return of({
                            action: "add" as const,
                            key: req.id,
                            observable: observable.pipe(
                                catchError(error => {
                                    return throwError(() => {
                                        return error
                                    })
                                    //return throwError(() => new RemoteError("call-failed", "Remote call to \"" + req.command + "\" failed.", { cause: error }))
                                }),
                                materialize(),
                            )
                        })
                    }
                }),
                registry,
                map(([answer, id]) => {
                    return {
                        kind: "N" as const,
                        value: {
                            id,
                            ...answer,
                        }
                    }
                }),
                materialize(),
                map(value => {
                    connection.next(value)
                })
            )
        })
    ).subscribe(() => void 0)
    return () => {
        subscription.unsubscribe()
    }
}

function call<T extends Target>(target: T, command: string | number | symbol, data: readonly unknown[]): Observable<unknown> | (() => Promise<unknown>) {
    if (!(command in target)) {
        throw new Error("Command " + command.toString() + " does not exist.")
    }
    const property = target[command as keyof T]
    const returned = (() => {
        if (typeof property === "function") {
            return property.call(target, ...data) as Allowed
        }
        return property as Allowed
    })()
    if (isObservable(returned)) {
        return returned
    }
    else {
        return async () => await returned
    }
}

type Target = object
type ID = string | number
type Primitive = string | number | boolean | null | undefined | void | bigint | { readonly [k: string]: Primitive } | readonly Primitive[]
type Allowed = Observable<unknown> | PromiseLike<unknown> | Primitive
type Remoted<T> = T extends Observable<infer R> ? Observable<R> : (T extends PromiseLike<infer R> ? PromiseLike<R> : PromiseLike<T>)
type Input<T> = T extends ((...args: any) => Allowed) ? Parameters<T> : readonly void[]
type Output<T> = T extends ((...args: any) => Allowed) ? Remoted<ReturnType<T>> : Remoted<T>
type Members<T extends Target> = { [K in string & keyof T as T[K] extends Allowed | ((...args: any) => Allowed) ? K : never]: T[K] }

type Proxied<T extends Target> = {

    readonly [K in keyof Members<T>]: (...input: Input<Members<T>[K]>) => Output<Members<T>[K]>

}


/**
 * Types for remote errors.
 */
type RemoteErrorCode = "worker-disappeared" | "invalid-message" | "call-failed"

//TODO evaluate these, which do we need?

/**
 * A special error with a retryable property, used when a migrating worker dies.
 */
class RemoteError extends Error {

    constructor(readonly code: RemoteErrorCode, message: string, options?: ErrorOptions) {
        super(message, options)
    }

}

interface ExecuteRequest {

    readonly kind: "execute"
    readonly id: ID
    readonly command: string | number
    readonly data: readonly unknown[]

}

interface SubscribeRequest {

    readonly kind: "subscribe"
    readonly id: ID
    readonly command: string | number
    readonly data: readonly unknown[]

}

interface UnsubscribeRequest {

    readonly kind: "unsubscribe"
    readonly id: ID

}

interface FulfilledResponse {

    readonly kind: "fulfilled"
    readonly id: ID
    readonly value: unknown

}

interface RejectedResponse {

    readonly kind: "rejected"
    readonly id: ID
    readonly error: unknown

}

interface NextResponse {

    readonly kind: "next"
    readonly id: ID
    readonly value: unknown

}

interface ErrorResponse {

    readonly kind: "error"
    readonly id: ID
    readonly error: unknown

}

interface CompleteResponse {

    readonly kind: "complete"
    readonly id: ID

}

type Request = ExecuteRequest | SubscribeRequest | UnsubscribeRequest

type Response = FulfilledResponse | RejectedResponse | NextResponse | ErrorResponse | CompleteResponse
