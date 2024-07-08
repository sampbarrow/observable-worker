
import pDefer from "p-defer"
import PLazy from "p-lazy"
import { BehaviorSubject, EMPTY, Observable, ObservableNotification, ReplaySubject, catchError, combineLatest, concatWith, defer, dematerialize, filter, finalize, first, firstValueFrom, from, fromEvent, ignoreElements, map, materialize, merge, mergeMap, of, share, shareReplay, startWith, switchMap, takeUntil, tap, throwError } from "rxjs"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { Batcher, BatcherOptions } from "./batcher"
import { Channel, Connection } from "./channel"
import { RemoteError } from "./error"
import { Answer, Call, ID, Sender, Target } from "./processing"
import { VolatileRemote, VolatileSenderRemote } from "./remote"
import { CallOptions } from "./sender"
import { ObservableAndPromise, RegistryAction, callOnTarget, closing, generateId, registry } from "./util"

namespace OldChannel {

    //TODO rm

    /**
     * Creates a channel from a port.
     */
    export function oldPort<I = never, O = unknown>(open: Observable<Channel.Port<I, O>>): OldChannel<I, O> {
        return new Observable<Connection<I, O>>(subscriber => {
            const subscription = open.subscribe(object => {
                subscriber.next(Channel.from(
                    fromEvent<MessageEvent<I>>(object, "message").pipe(map(_ => _.data)),
                    value => {
                        try {
                            object.postMessage(value)
                        }
                        catch (e) {
                            console.error(e)
                            subscriber.error(e)
                        }
                    },
                    () => void 0,
                ))
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
        return combineLatest([oldBroadcast<I>(input), oldBroadcast<O>(output)]).pipe(map(([a, b]) => Channel.from(a, b)))
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
                return Channel.from<I, O>(connection.pipe(mergeMap(items => items)), value => connection.next([value]))
            })
        )
    }

    /**
     * Wraps another channel and batches any messages sent to it. Also treats incoming messages as batches.
     */
    export function batchingOld<I, O>(channel: OldChannel<readonly I[], readonly O[]>, options?: BatcherOptions | undefined) {
        return channel.pipe(
            map(connection => {
                const batcher = new Batcher<O>(connection.next.bind(connection), options)
                return Channel.from<I, O>(
                    connection.pipe(mergeMap(items => items)),
                    batcher.add.bind(batcher)
                )
            })
        )
    }
}

export type Finder = ChannelFactory<ObservableNotification<Answer>, Call>
export type Advertiser = Observable<RegistryAction<string, Connection<Call, ObservableNotification<Answer>>>>

export const DEFAULT_CONTEXT = "default"

export interface BroadcastCoordinatorOptions {

    readonly context?: string

}

export function broadcastFinder(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastFinder(options.context ?? DEFAULT_CONTEXT, (id1, id2) => OldChannel.oldDualBroadcast(id1, id2))
}
export function broadcastAdvertiser(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastAdvertiser(options.context ?? DEFAULT_CONTEXT, (id1, id2) => OldChannel.oldDualBroadcast(id1, id2))
}

export interface BroadcastCoordinatorBatchingOptions {

    readonly context?: string | undefined
    readonly batcher?: BatcherOptions | undefined

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
                                        observable: createBroadcastChannel<Call, ObservableNotification<Answer>>(message.callChannelId, message.answerChannelId)
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

function buildBroadcastFinder(context: string, createBroadcastChannel: BroadcastChannelCreator): ChannelFactory<ObservableNotification<Answer>, Call> {
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
                                            return createBroadcastChannel<ObservableNotification<Answer>, Call>(answerChannelId, callChannelId).pipe(
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

export interface VolatileChannelSenderOptions extends CallOptions {

    readonly channel: ChannelFactory<ObservableNotification<Answer>, Call>

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
    withOptions(options: CallOptions) {
        return new VolatileChannelSender({ ...this.config, ...options, channel: this.channel })
    }

    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown> {
        const observable = this.channel.pipe(
            withVolatility(this.config.autoRetryObservables ?? true),
            switchMap(_ => _),
            switchMap(connection => {
                const id = generateId()
                const send = {
                    kind: "S" as const,
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
                            kind: "U",
                            id
                        })
                    }),
                    dematerialize(),
                    answer(id, command, this.config.acknowledgementTimeout),
                )
            })
        )
        const promise = PLazy.from(async () => {
            return await firstValueFrom(this.channel.pipe(
                withVolatility(this.config.autoRetryPromises ?? false),
                switchMap(_ => _),
                switchMap(connection => {
                    const id = generateId()
                    const send = {
                        kind: "X" as const,
                        id,
                        command,
                        data
                    }
                    const observable = connection.pipe(
                        dematerialize(),
                        answer(id, command, this.config.acknowledgementTimeout)
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

export interface WrapMigratingConfig extends CallOptions {

    readonly finder: Finder

}

export function wrapMigrating<T extends Target>(config: WrapMigratingConfig) {
    return wrapVolatile<T>({
        channel: config.finder,
        acknowledgementTimeout: config.acknowledgementTimeout,
        connectionTimeout: config.connectionTimeout,
        autoRetryPromises: config.autoRetryPromises,
        autoRetryObservables: config.autoRetryObservables,
        promiseTimeout: config.promiseTimeout,
    })
}


export interface WrapVolatileOptions extends VolatileChannelSenderOptions {
}

export function wrapVolatile<T extends Target>(options: WrapVolatileOptions): VolatileRemote<T> {
    return new VolatileSenderRemote<T>(new VolatileChannelSender(options))
}

interface ExposeConfig<T extends Target> {

    readonly target: T
    readonly channel: OldChannel<Call, ObservableNotification<Answer>>

}

function expose<T extends Target>(config: ExposeConfig<T>) {
    const subscription = config.channel.pipe(
        switchMap(connection => {
            return connection.pipe(
                mergeMap(call => {
                    if (call.kind === "U") {
                        return of({
                            action: "delete" as const,
                            key: call.id
                        })
                    }
                    else {
                        const observable = defer(() => {
                            const input = callOnTarget(config.target, call.command, call.data)
                            if (call.kind === "S") {
                                if (input.observable === undefined) {
                                    throw new RemoteError("invalid-message", "Trying to treat a promise as an observable.")
                                }
                                else {
                                    return input.observable
                                }
                            }
                            else {
                                if (input.promise === undefined) {
                                    throw new RemoteError("invalid-message", "Trying to treat an observable as a promise.")
                                }
                                else {
                                    return defer(input.promise)
                                }
                            }
                        })
                        return of({
                            action: "add" as const,
                            key: call.id,
                            observable: observable.pipe(
                                catchError(error => {
                                    return throwError(() => new RemoteError("call-failed", "Remote call to \"" + call.command + "\" failed.", { cause: error }))
                                }),
                                materialize(),
                            )
                        })
                    }
                }),
                registry,
                map(([id, answer]) => {
                    return {
                        id,
                        ...answer,
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
