import { EMPTY, Observable, ObservableInput, OperatorFunction, Unsubscribable, catchError, from, map, mergeMap, of, switchMap, throwError } from "rxjs"
import { Channel } from "./channel"
import { Allowed, Answer, Call, Exposed, Target } from "./processing"

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

    readonly target: ObservableInput<T>
    readonly channel: Channel<Call, Answer>
    readonly log?: boolean | undefined

}

export class DirectReceiver<T extends Target> extends Observable<void> implements Exposed {

    constructor(private readonly config: DirectReceiverConfig<T>) {
        super(subscriber => {
            const subscriptions = new Map<unknown, Unsubscribable>()
            if (config.log) {
                console.log("[Worker] Starting receiver.", this.config.channel)
            }
            const sub = this.config.channel.pipe(
                switchMap(connection => {
                    return from(config.target).pipe(
                        switchMap(target => {
                            return connection.pipe(
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
                                            if (!(call.command in target)) {
                                                throw new Error("Command " + call.command.toString() + " does not exist.")
                                            }
                                            const property = target[call.command as keyof T]
                                            const input = (() => {
                                                if (typeof property === "function") {
                                                    return property.call(target, ...call.data) as Allowed
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
