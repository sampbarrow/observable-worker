
import { EMPTY, Observable, catchError, defer, filter, map, materialize, mergeMap, of, takeUntil } from "rxjs"
import { Channel } from "./channel"
import { Allowed, Request, Response, Target } from "./types"
import { RemoteError } from "./util"

export interface ExposeConfig<T extends Target> {

    readonly target: T
    readonly channel: Channel<Request, Response>

}

export function expose<T extends Target>(config: ExposeConfig<T>) {
    const connection = config.channel()
    const observable = connection.pipe(
        mergeMap(request => {
            if (request.kind === "unsubscribe") {
                return EMPTY
            }
            if (!(request.command in config.target)) {
                return of({
                    kind: "rejected" as const,
                    id: request.id,
                    error: new RemoteError("invalid-message", "Command \"" + request.command + "\" does not exist on target."),
                })
            }
            const property = config.target[request.command as keyof T]
            const input = (() => {
                if (typeof property === "function") {
                    return property.call(config.target, ...request.data) as Allowed
                }
                return property as Allowed
            })()
            if (request.kind === "subscribe") {
                if (!(input instanceof Observable)) {
                    return of({
                        kind: "error" as const,
                        id: request.id,
                        error: new RemoteError("invalid-message", "Trying to treat a promise as an observable."),
                    })
                }
                else {
                    const observable = input.pipe(
                        materialize(),
                        map(materialized => {
                            if (materialized.kind === "N") {
                                return {
                                    kind: "next" as const,
                                    id: request.id,
                                    value: materialized.value,
                                }
                            }
                            else if (materialized.kind === "E") {
                                return {
                                    kind: "error" as const,
                                    id: request.id,
                                    error: new RemoteError("call-failed", "Remote call to \"" + request.command + "\" failed.", { cause: materialized.error }),
                                }
                            }
                            else {
                                return {
                                    kind: "complete" as const,
                                    id: request.id,
                                }
                            }
                        })
                        /*
                        map(value => {
                            return {
                                kind: "next" as const,
                                id: request.id,
                                value,
                            }
                        }),
                        catchError(error => {
                            return of({
                                kind: "error" as const,
                                id: request.id,
                                error: new RemoteError("call-failed", "Remote call to \"" + request.command + "\" failed.", { cause: error }),
                            })
                        }),
                        concatWith(of({
                            kind: "complete" as const,
                            id: request.id,
                        })),*/
                    )
                    return observable.pipe(
                        takeUntil(connection.pipe(
                            filter(message => {
                                return message.kind === "unsubscribe" && message.id === request.id
                            })
                        ))
                    )
                }
            }
            else {
                if (input instanceof Observable) {
                    return of({
                        kind: "error" as const,
                        id: request.id,
                        error: new RemoteError("invalid-message", "Trying to treat an observable as a promise."),
                    })
                }
                else {
                    return defer(async () => await input).pipe(
                        map(value => {
                            return {
                                kind: "fulfilled" as const,
                                id: request.id,
                                value,
                            }
                        }),
                        catchError(error => {
                            return of({
                                kind: "rejected" as const,
                                id: request.id,
                                error: new RemoteError("call-failed", "Remote call to \"" + request.command + "\" failed.", { cause: error }),
                            })
                        }),
                    )
                }
            }
        })
    )
    const subscription = observable.subscribe(connection)
    return () => {
        subscription.unsubscribe()
        connection.close()
    }
}

/*
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
    if (returned instanceof Observable) {
        return returned
    }
    else {
        return async () => await returned
    }
}
*/