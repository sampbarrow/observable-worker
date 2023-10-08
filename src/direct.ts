import PLazy from "p-lazy"
import { NEVER, Observable, Unsubscribable, defer, filter, finalize, firstValueFrom, map, mergeMap, of, share, throwError } from "rxjs"
import { Channel } from "./channel"
import { Allowed, Answer, Call, Remote, Sender, Target } from "./processing"
import { ObservableAndPromise, WORKER_LOG, generateId } from "./util"

export type DirectSenderConfig = {

    readonly channel: Channel<Answer, Call>

}

export class DirectSender implements Sender {

    private readonly connection
    private readonly subscriptions = new Array<string>()

    constructor(config: DirectSenderConfig) {
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
            if (WORKER_LOG) {
                console.log("[Worker] Sending an execution request", { id, command, data })
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

export type DirectReceiverConfig<T> = {

    readonly target: T
    readonly channel: Channel<Call, Answer>

}

/*
export function receiveOp<T extends Target>(target: T): OperatorFunction<Call, Answer> {
    return call => {
        const subscriptions = new Map<unknown, Unsubscribable>()
        return call.pipe(

        )
    }
}
*/

export class DirectReceiver<T extends Target> extends Observable<void> {

    constructor(private readonly config: DirectReceiverConfig<T>) {
        super(subscriber => {
            const subscriptions = new Map<unknown, Unsubscribable>()
            if (WORKER_LOG) {
                console.log("[Worker] Starting receiver.", this.config.channel)
            }
            const connection = this.config.channel.open()
            const sub = connection.pipe(
                map(call => {
                    if (WORKER_LOG) {
                        console.log("[Worker] Receiver received a message.", call)
                    }
                    if (call.type === "unsubscribe") {
                        const sub = subscriptions.get(call.id)
                        if (sub === undefined) {
                            throw new Error("Tried to unsubscribe from a non-existent subscription (" + call.id.toString() + ").")
                        }
                        sub.unsubscribe()
                        subscriptions.delete(call.id)
                    }
                    else {
                        try {
                            if (!(call.command in this.config.target)) {
                                throw new Error("Command " + call.command.toString() + " does not exist.")
                            }
                            const property = this.config.target[call.command as keyof T]
                            const input = (() => {
                                if (typeof property === "function") {
                                    return property.call(this.config.target, ...call.data) as Allowed
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
                })
            ).subscribe(subscriber)
            return () => {
                sub.unsubscribe()
                connection.close()
                subscriptions.forEach(subscription => subscription.unsubscribe())
                subscriptions.clear()
            }
        })
    }

}
