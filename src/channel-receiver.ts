import { EMPTY, Observable, ObservableInput, Unsubscribable, from, mergeMap, switchMap } from "rxjs"
import { Channel } from "./channel"
import { Allowed, Answer, Call, Receiver, Target } from "./processing"
import { RemoteError } from "./util"

export interface ChannelReceiverConfig<T> {

    readonly target: ObservableInput<T>
    readonly channel: Channel<Call, Answer>
    readonly log?: boolean | undefined

}

export class ChannelReceiver<T extends Target> extends Observable<void> implements Receiver {

    constructor(private readonly config: ChannelReceiverConfig<T>) {
        super(subscriber => {
            const subscriptions = new Map<unknown, Unsubscribable>()
            if (config.log) {
                console.log("[Worker/Receiver] Starting receiver.", this.config.channel)
            }
            const sub = this.config.channel.pipe(
                switchMap(connection => {
                    if (config.log) {
                        console.log("[Worker/Receiver] Got a connection.", connection)
                    }
                    return from(config.target).pipe(
                        switchMap(target => {
                            if (config.log) {
                                console.log("[Worker/Receiver] Got a target.", target)
                            }
                            return connection.pipe(
                                mergeMap(call => {
                                    if (config.log) {
                                        console.log("[Worker/Receiver] Receiver received a message.", call)
                                    }
                                    if (call.type === "unsubscribe") {
                                        const subscription = subscriptions.get(call.id)
                                        /*
                                        if (subscription === undefined) {
                                            return EMPTY
                                        }*/
                                        //TODO if we treat an obs as a promise, itll send back an error
                                        //wont it then try to unsubscribe? thatll trigger this
                                        if (subscription === undefined) {
                                            connection.error(new Error("Tried to unsubscribe from a non-existent subscription (" + call.id?.toString() + ")."))
                                            return EMPTY
                                        }
                                        subscription.unsubscribe()
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
                                            if (call.type === "subscribe") {
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
                                                    connection.next({
                                                        id: call.id,
                                                        type: "error",
                                                        error: new RemoteError("invalid-message", "Trying to treat a promise as an observable.")
                                                    })
                                                }
                                            }
                                            else {
                                                if (typeof input === "object" && input !== null && "subscribe" in input && input.subscribe !== undefined) {
                                                    connection.next({
                                                        id: call.id,
                                                        type: "error",
                                                        error: new RemoteError("invalid-message", "Trying to treat an observable as a promise.")
                                                    })
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
