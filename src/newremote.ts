import PLazy from "p-lazy"
import { NEVER, ReplaySubject, filter, finalize, first, firstValueFrom, map, merge, mergeMap, of, share, skip, switchMap, throwError } from "rxjs"
import { Channel, Connection } from "./channel"
import { Answer, Call, Input, ObservableMembers, Output, PromiseMembers, Target, Wrapper } from "./processing"
import { ObservableAndPromise, RemoteError, generateId } from "./util"

export type NewRemote<T extends Target> = {

    observe<K extends keyof ObservableMembers<T>>(key: K, ...args: Input<ObservableMembers<T>[K]>): Output<ObservableMembers<T>[K]>
    execute<K extends keyof PromiseMembers<T>>(key: K, ...args: Input<PromiseMembers<T>[K]>): Output<PromiseMembers<T>[K]>

}

export interface NewRemoteConfig<T> {

    target: T

}

export interface ObserveOptions {

    autoRetry?: boolean | undefined

}

export interface ExecuteOptions {

    autoRetry?: boolean | undefined

}

export interface ChannelWrapperConfig {

    readonly channel: Channel<Answer, Call>
    readonly log?: boolean | undefined
    readonly autoRetryPromises?: boolean | undefined
    readonly autoRetryObservables?: boolean | undefined

}

export class ChannelWrapper implements Wrapper {

    private readonly channel
    // private readonly connection

    constructor(private readonly config: ChannelWrapperConfig) {
        //TODO connectable SHOULD work here but it doesnt - look at it later
        this.channel = new ReplaySubject<Connection<Answer, Call>>(1)
        config.channel.subscribe(v => {
            this.channel.next(v)
        })
        //TODO make sure closing this kills all the subscriptions
        //this.channel = config.channel.pipe(shareReplay({ refCount: true, bufferSize: 1 }))
        // this.channel = connectable(config.channel.pipe(map(_ => _.open())), { connector: () => new ReplaySubject(1) })
        //  this.connection = this.channel.connect()
    }

    connected() {
        return this.channel.pipe(map(() => void 0))
    }
    close() {
        this.channel.complete()
        // this.connection.unsubscribe()
    }

    private current(retryOnInterrupt: boolean) {
        return merge(
            this.channel.pipe(first()),
            this.channel.pipe(
                skip(1),
                map(sender => {
                    if (retryOnInterrupt) {
                        return sender
                    }
                    else {
                        throw new RemoteError("worker-disappeared", "The worker was closed. Please try again.")
                    }
                })
            )
        )
    }

    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown> {
        if (this.config.log) {
            console.log("[Worker/Sender] Received command.", { command, data })
        }
        const observable = this.current(this.config.autoRetryObservables ?? true).pipe(
            switchMap(connection => {
                const id = generateId()
                if (this.config.log) {
                    console.log("[Worker/Sender] Sending an observable call.", { id, command, data })
                }
                connection.next({
                    type: "subscribe",
                    id,
                    command,
                    data
                })
                return connection.pipe(
                    filter(response => response.id === id),
                    mergeMap(response => {
                        if (this.config.log) {
                            console.log("[Worker/Sender] Received a response to an observable call.", response)
                        }
                        if (response.type === "next") {
                            return of(response.value)
                        }
                        else if (response.type === "error") {
                            return throwError(() => response.error)
                        }
                        else if (response.type === "complete") {
                            return NEVER
                        }
                        else {
                            return throwError(() => new RemoteError("invalid-message", "Received an invalid response to an observable call."))
                        }
                    }),
                    finalize(() => {
                        connection.next({
                            type: "unsubscribe",
                            id
                        })
                    }),
                )
            }),
            share()
        )
        const promise = PLazy.from(async () => {
            return firstValueFrom(this.current(this.config.autoRetryPromises ?? true).pipe(
                switchMap(connection => {
                    const id = generateId()
                    if (this.config.log) {
                        console.log("[Worker/Sender] Sending a promise call.", { id, command, data })
                    }
                    connection.next({
                        type: "execute",
                        id,
                        command,
                        data
                    })
                    return connection.pipe(
                        filter(response => response.id === id),
                        mergeMap(response => {
                            if (this.config.log) {
                                console.log("[Worker/Sender] Received a response to a promise call.", response)
                            }
                            if (response.type === "fulfilled") {
                                return of(response.value)
                            }
                            else if (response.type === "error") {
                                return throwError(() => response.error)
                            }
                            else {
                                return throwError(() => new RemoteError("invalid-message", "Received an invalid response to a promise call."))
                            }
                        })
                    )
                })
            ))
        })
        return new ObservableAndPromise(observable, promise)
    }

}

/*
export interface ObservableResult<T> {

    observe(options?: ObserveOptions): Observable<T>

}

export interface PromiseResult<T> {

    execute(options?: ExecuteOptions): Promise<T>

}

export type NewResult<T> = ObservableResult<T> | PromiseResult<T>
*/

/*
export class OldChannelWrapper implements Wrapper {

    private readonly channel
    // private readonly connection

    constructor(private readonly config: ChannelWrapperConfig) {
        //TODO connectable SHOULD work here but it doesnt - look at it later
        this.channel = new ReplaySubject<Connection<Answer, Call>>(1)
        config.channel.subscribe(v => {
            this.channel.next(v)
        })
        //TODO make sure closing this kills all the subscriptions
        //this.channel = config.channel.pipe(shareReplay({ refCount: true, bufferSize: 1 }))
        // this.channel = connectable(config.channel.pipe(map(_ => _.open())), { connector: () => new ReplaySubject(1) })
        //  this.connection = this.channel.connect()
    }

    connected() {
        return this.channel.pipe(map(() => void 0))
    }
    close() {
        this.channel.complete()
        // this.connection.unsubscribe()
    }

    current(retryOnInterrupt: boolean) {
        return merge(
            this.channel.pipe(first()),
            this.channel.pipe(
                skip(1),
                map(sender => {
                    if (retryOnInterrupt) {
                        return sender
                    }
                    else {
                        throw new RemoteError(true, "The worker was closed. Please try again.")
                    }
                })
            )
        )
    }

    call(command: string, ...data: readonly unknown[]): NewResult<unknown> {
        if (this.config.log) {
            console.log("[Worker/Sender] Received command.", { command, data })
        }
        return {
            observe: (options: ObserveOptions = {}) => {
                if (this.config.log) {
                    console.log("[Worker/Sender] Running observe command.", { command, data })
                }
                const observable = this.current(options.autoRetry ?? this.config.autoRetryObservables ?? true).pipe(
                    switchMap(connection => {
                        const id = generateId()
                        if (this.config.log) {
                            console.log("[Worker/Sender] Sending an observable call.", { id, command, data })
                        }
                        connection.next({
                            type: "subscribe",
                            id,
                            command,
                            data
                        })
                        return connection.pipe(
                            filter(response => response.id === id),
                            mergeMap(response => {
                                if (this.config.log) {
                                    console.log("[Worker/Sender] Received a response to an observable call.", response)
                                }
                                if (response.type === "next") {
                                    return of(response.value)
                                }
                                else if (response.type === "error") {
                                    return throwError(() => response.error)
                                }
                                else if (response.type === "complete") {
                                    return NEVER
                                }
                                else {
                                    return throwError(() => "Received an invalid response to an observable call.")
                                }
                            }),
                            finalize(() => {
                                connection.next({
                                    type: "unsubscribe",
                                    id
                                })
                            }),
                        )
                    }),
                    share()
                )
                return observable
            },
            execute: async (options: ExecuteOptions = {}) => {
                if (this.config.log) {
                    console.log("[Worker/Sender] Running execute command.", { command, data })
                }
                return firstValueFrom(this.current(options.autoRetry ?? this.config.autoRetryPromises ?? false).pipe(
                    mergeMap(connection => {
                        const id = generateId()
                        if (this.config.log) {
                            console.log("[Worker/Sender] Sending an asynchronous call", { connection, id, command, data })
                        }
                        const piped = connection.pipe(
                            filter(response => response.id === id),
                            map(response => {
                                if (this.config.log) {
                                    console.log("[Worker/Sender] Received a response to an asynchronous call.", response)
                                }
                                if (response.type === "fulfilled") {
                                    return response.value
                                }
                                else if (response.type === "error") {
                                    throw response.error
                                }
                                else {
                                    throw new Error("Received an invalid response to an asynchronous call.")
                                }
                            })
                        )
                        connection.next({
                            type: "subscribe",
                            id,
                            command,
                            data
                        })
                        if (this.config.log) {
                            console.log("[Worker/Sender] Asynchronous call has been sent.", { connection, id, command, data })
                        }
                        return piped
                    })
                ))
            }
        }
    }

}*/
