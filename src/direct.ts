import { EMPTY, Observable, OperatorFunction, Unsubscribable, catchError, finalize, from, map, mergeMap, of, switchMap, throwError } from "rxjs"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { Channel, Closeable } from "./channel"
import { Allowed, Answer, Call, Target } from "./processing"

export type DirectSenderConfig = {

    readonly channel: Channel<Answer, Call>
    readonly log?: boolean | undefined

}

/*
export class DirectSender implements OldSender {

    private readonly connection
    private readonly subscriptions = new Array<string>()

    constructor(private readonly config: DirectSenderConfig) {
        this.connection = config.channel.open()
    }

    close() {
        this.subscriptions.splice(0).forEach(id => {
            this.connection.next({
                type: "unsubscribe",
                id
            })
        })
    }

    //TODO handle closing

    call(command: string, ...data: readonly unknown[]) {
        const promise = PLazy.from(async () => {
            const id = generateId()
            if (this.config.log) {
                console.log("[Worker] Sending an asynchronous call", { id, command, data })
            }
            this.connection.next({
                type: "execute",
                id,
                command,
                data
            })
            return firstValueFrom(this.connection.pipe(
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
            ))
        })
        const observable = defer(() => {
            const id = generateId()
            if (this.config.log) {
                console.log("[Worker/Sender] Sending an observable call.", { id, command, data })
            }
            this.connection.next({
                type: "subscribe",
                id,
                command,
                data
            })
            this.subscriptions.push(id)
            return this.connection.pipe(
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
                    this.connection.next({
                        type: "unsubscribe",
                        id
                    })
                }),
            )
        }).pipe(
            share()
        )
        return new ObservableAndPromise(observable, promise)
    }

    as<T extends Target>() {
        const proxy = new Proxy(this, {
            get(target, key) {
                if (typeof key === "string") {
                    return (...args: unknown[]) => target.call(key, ...args)
                }
                else {
                    return super.get(target, key)
                }
            }
        })
        return proxy as unknown as Remote<T>
    }

}
*/

/*
export function receiveOp<T extends Target>(target: T): OperatorFunction<Call, Answer> {
    return call => {
        const subscriptions = new Map<unknown, Unsubscribable>()
        return call.pipe(

        )
    }
}
*/

export type ReceiveConfig<T extends Target> = {

    readonly target: T
    readonly log?: boolean | undefined

}

export function receive<T extends Target>(config: ReceiveConfig<T>): OperatorFunction<Call, Answer> {
    const subscriptions = new Map<unknown, Unsubscribable>()
    if (config.log) {
        console.log("[Worker] Starting receiver.")
    }
    return call => {
        return call.pipe(
            mergeMap(call => {
                if (config.log) {
                    console.log("[Worker/Receiver] Receiver received a message.", call)
                }
                if (call.type === "unsubscribe") {
                    const sub = subscriptions.get(call.id)
                    if (sub === undefined) {
                        return throwError(() => new Error("Tried to unsubscribe from a non-existent subscription (" + call.id?.toString() + ")."))
                    }
                    sub.unsubscribe()
                    subscriptions.delete(call.id)
                    return EMPTY
                }
                else {
                    try {
                        if (typeof call !== "object") {
                            return throwError(() => new Error("Command is not an object. Are you trying to connect a batching worker with a non-batching client, or vice versa?"))
                        }
                        if (!(call.command in config.target)) {
                            return throwError(() => new Error("Command " + call.command.toString() + " does not exist."))
                        }
                        const property = config.target[call.command as keyof T]
                        const input = (() => {
                            if (typeof property === "function") {
                                return property.call(config.target, ...call.data) as Allowed
                            }
                            else {
                                return property as Allowed
                            }
                        })()
                        if (typeof input === "object" && input !== null && "pipe" in input && input.subscribe !== undefined) {
                            const observable = new Observable<Answer>(sub => {
                                const sup = input.subscribe({
                                    next: value => {
                                        sub.next({
                                            id: call.id,
                                            type: "next",
                                            value
                                        })
                                    },
                                    error: error => {
                                        sub.next({
                                            id: call.id,
                                            type: "error",
                                            error
                                        })
                                    },
                                    complete: () => {
                                        sub.next({
                                            id: call.id,
                                            type: "complete"
                                        })
                                    }
                                })
                                return () => {
                                    sup.unsubscribe()
                                }
                            })
                            return observable//TODO urgent close this when we get an unsub command
                        }
                        else {
                            const value = (async () => await input)()
                            return from(value).pipe(
                                map(value => {
                                    return {
                                        id: call.id,
                                        type: "fulfilled" as const,
                                        value
                                    }
                                }),
                                catchError(error => {
                                    return of({
                                        id: call.id,
                                        type: "error" as const,
                                        error
                                    })
                                })
                            )
                        }
                    }
                    catch (error) {
                        return of({
                            id: call.id,
                            type: "error" as const,
                            error
                        })
                    }
                }
            })
        )
    }
}

export type DirectReceiverConfig<T> = {

    readonly target: ValueOrFactory<Closeable<T>>
    readonly channel: Channel<Call, Answer>
    readonly log?: boolean | undefined

}

export class DirectReceiver<T extends Target> extends Observable<void> {

    constructor(private readonly config: DirectReceiverConfig<T>) {
        super(subscriber => {
            const subscriptions = new Map<unknown, Unsubscribable>()
            if (config.log) {
                console.log("[Worker] Starting receiver.", this.config.channel)
            }
            const sub = this.config.channel.pipe(
                switchMap(connection => {
                    const target = callOrGet(config.target)
                    return connection.pipe(
                        finalize(() => {
                            target.close?.()
                        }),
                        mergeMap(call => {
                            if (config.log) {
                                console.log("[Worker/Receiver] Receiver received a message.", call)
                            }
                            if (call.type === "unsubscribe") {
                                const sub = subscriptions.get(call.id)
                                if (sub === undefined) {
                                    connection.error(new Error("Tried to unsubscribe from a non-existent subscription (" + call.id?.toString() + ")."))
                                    return EMPTY
                                }
                                sub.unsubscribe()
                                subscriptions.delete(call.id)
                            }
                            else {
                                try {
                                    if (typeof call !== "object") {
                                        throw new Error("Command is not an object. Are you trying to connect a batching worker with a non-batching client, or vice versa?")
                                    }
                                    if (!(call.command in target.object)) {
                                        throw new Error("Command " + call.command.toString() + " does not exist.")
                                    }
                                    const property = target.object[call.command as keyof T]
                                    const input = (() => {
                                        if (typeof property === "function") {
                                            return property.call(target.object, ...call.data) as Allowed
                                        }
                                        else {
                                            return property as Allowed
                                        }
                                    })()
                                    if (typeof input === "object" && input !== null && "subscribe" in input && input.subscribe !== undefined) {
                                        subscriptions.set(call.id, input.subscribe({
                                            next: value => {
                                                connection.next({
                                                    id: call.id,
                                                    type: "next",
                                                    value
                                                })
                                            },
                                            error: error => {
                                                connection.next({
                                                    id: call.id,
                                                    type: "error",
                                                    error
                                                })
                                            },
                                            complete: () => {
                                                connection.next({
                                                    id: call.id,
                                                    type: "complete"
                                                })
                                            }
                                        }))
                                    }
                                    else {
                                        const value = (async () => await input)()
                                        value.then(value => {
                                            connection.next({
                                                id: call.id,
                                                type: "fulfilled",
                                                value
                                            })
                                        })
                                        value.catch(error => {
                                            connection.next({
                                                id: call.id,
                                                type: "error",
                                                error
                                            })
                                        })
                                    }
                                }
                                catch (error) {
                                    connection.next({
                                        id: call.id,
                                        type: "error",
                                        error
                                    })
                                }
                            }
                            return EMPTY
                        })
                    )
                }),
            ).subscribe(subscriber)
            return () => {
                sub.unsubscribe()
                subscriptions.forEach(subscription => subscription.unsubscribe())
                subscriptions.clear()
            }
        })
    }

}
