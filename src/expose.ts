
import { Observable, defer, filter, map, materialize, mergeMap, of, share, takeUntil } from "rxjs"
import { callOrGet } from "value-or-factory"
import { Channel } from "./channel"
import { Member, Request, Response, SubscribeRequest, Target } from "./types"

export interface ExposeConfig<T extends Target> {

    readonly target: T
    readonly channel: Channel<Request, Response>

}

export function expose<T extends Target>(config: ExposeConfig<T>) {
    const connection = config.channel()
    const shared = connection.observe.pipe(share())
    const observable = shared.pipe(
        filter((request): request is SubscribeRequest => request.kind === "S"),
        mergeMap(request => {
            try {
                if (!(request.command in config.target)) {
                    throw new TypeError("Command \"" + request.command + "\" does not exist on target.")
                }
                const property = (config.target as Record<string, Member>)[request.command]
                const input = callOrGet(property, ...request.data)
                const observable = (input instanceof Observable ? input : defer(async () => await input))
                return observable.pipe(
                    materialize(),
                    map(response => {
                        return {
                            ...response,
                            id: request.id,
                        }
                    }),
                    takeUntil(shared.pipe(
                        filter(message => {
                            return message.kind === "U" && message.id === request.id
                        })
                    )),
                )
            }
            catch (error) {
                return of({
                    kind: "E" as const,
                    id: request.id,
                    error
                })
            }
        })
    )
    const subscription = observable.subscribe(response => connection.send(response))
    return () => {
        subscription.unsubscribe()
        connection.close()
    }
}
