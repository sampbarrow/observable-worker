
import { ObservableNotification, catchError, defer, map, materialize, mergeMap, of, repeat, throwError } from "rxjs"
import { Channel } from "./channel"
import { RemoteError } from "./error"
import { Answer, Call, Target } from "./processing"
import { callOnTarget, registry } from "./util"

export interface ExposeConfig<T extends Target> {

    readonly target: T
    readonly channel: Channel<Call, ObservableNotification<Answer>>

}

export function expose<T extends Target>(config: ExposeConfig<T>) {
    const connection = config.channel()
    const subscription = connection.pipe(
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
        repeat() //TODO is this really the best way?
    ).subscribe(connection)
    return () => {
        subscription.unsubscribe()
        connection.close?.()
    }
}
