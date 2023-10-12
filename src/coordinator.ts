import { EMPTY, Observable, defer, filter, first, map, merge, mergeMap, mergeWith, of, switchMap, tap } from "rxjs"
import { Channel } from "./channel"
import { DEFAULT_CONTEXT, RegistrationMessage } from "./migrating"
import { Answer, Call } from "./processing"
import { generateId, observeWebLock } from "./util"

export type CoordinationAction = {
    readonly action: "added"
    readonly id: string
    readonly channel: Channel<Call, Answer>
} | {
    readonly action: "removed"
    readonly id: string
}

export type Coordinator = {

    readonly backEnd: Observable<CoordinationAction>
    readonly frontEnd: Channel<Answer, Call>

}

export namespace Coordinator {

    export function broadcast(context: string = DEFAULT_CONTEXT): Coordinator {
        return {
            frontEnd: findAndRegisterWithServer(context, true),//TODO log config options
            backEnd: observeWebLock(context).pipe(
                switchMap(() => {
                    const registrationId = generateId()
                    const registration = Channel.broadcast<RegistrationMessage>(registrationId)
                    const lookup = lookupListen(context, registrationId).subscribe()//TODO work into the rxjs chain
                    return registration.pipe(
                        switchMap(connection => {
                            return connection.pipe(
                                mergeMap(message => {
                                    if (message.type === "registerClient") {
                                        connection.next({
                                            type: "clientRegistered",
                                            clientId: message.clientId
                                        })
                                        if (true) {//TODO
                                            console.log("[Worker/Migrating] Received a registration request from client " + message.clientId + ".")
                                        }
                                        return merge(
                                            of({
                                                action: "added" as const,
                                                id: message.clientId,
                                                channel: Channel.batching<Call, Answer>(Channel.dualBroadcast(message.callChannelId, message.answerChannelId))
                                            }),
                                            observeWebLock(message.lockId).pipe(
                                                map(() => {
                                                    return {
                                                        action: "removed" as const,
                                                        id: message.clientId,
                                                    }
                                                })
                                            )
                                        )
                                    }
                                    else {
                                        return EMPTY
                                    }
                                })
                            )
                        })
                    )
                })
            )
        }
    }

}

export type LookupMessage = {
    readonly type: "askIfServerIsAvailable"
} | {
    readonly type: "newServerStarted"
    readonly channelId: string
} | {
    readonly type: "serverIsAvailable"
    readonly channelId: string
}

function lookupListen(context: string, registrationChannelId: string, log?: boolean) {
    const lookup = Channel.broadcast<LookupMessage>(context)
    return lookup.pipe(
        switchMap(lookup => {
            if (log) {
                console.log("[Worker/Migrating] Sending a server started message on the lookup channel.", { context })
            }
            return merge(
                of({
                    type: "newServerStarted" as const,
                    channelId: registrationChannelId
                }),
                lookup.pipe(
                    filter(message => message.type === "askIfServerIsAvailable"),
                    map(() => {
                        if (log) {
                            console.log("[Worker/Migrating] Received a server availability check on the lookup channel.", { context })
                        }
                        return {
                            type: "serverIsAvailable" as const,
                            channelId: registrationChannelId
                        }
                    })
                )
            ).pipe(
                tap(response => {
                    lookup.next(response)
                })
            )
        })
    )
}

export function registerWithServer(channelId: string, log?: boolean) {
    return defer(() => {
        if (log) {
            console.log("[Worker/Migration] Registering with server over registration channel " + channelId + ".")
        }
        const lockId = generateId()
        return observeWebLock(lockId).pipe(
            mergeMap(() => {
                const registration = Channel.broadcast<RegistrationMessage>(channelId)
                return registration.pipe(
                    mergeMap(registration => {
                        const clientId = generateId()
                        if (log) {
                            console.log("[Worker/Migration] Registering client " + clientId + " on registration channel " + channelId + ".")
                        }
                        const callChannelId = generateId()
                        const answerChannelId = generateId()
                        const registered = registration.pipe(
                            filter(message => message.type === "clientRegistered" && message.clientId === clientId),
                            first(),
                            map(() => {
                                return {
                                    callChannelId,
                                    answerChannelId
                                }
                            })
                        )
                        //TODO try to ensure proper priorities or just rely on locks?
                        registration.next({
                            type: "registerClient",
                            clientId,
                            lockId,
                            callChannelId,
                            answerChannelId,
                        })
                        return registered
                    })
                )
            })
        )
    })
}

export function findAndRegisterWithServer(context: string = DEFAULT_CONTEXT, log?: boolean) {
    return findServer(context, log).pipe(
        switchMap(channelId => {
            return registerWithServer(channelId, log)
        }),
        switchMap(channelIds => {
            const calls = Channel.batching(Channel.broadcast<Call[]>(channelIds.callChannelId), { log })
            const answers = Channel.batching(Channel.broadcast<Answer[]>(channelIds.answerChannelId), { log })
            return Channel.combine(answers, calls)
        })
    )
}

export function findServer(context: string = DEFAULT_CONTEXT, log?: boolean) {
    return defer(() => {
        //TODO close
        const lookup = Channel.broadcast<LookupMessage>(context)
        if (log) {
            console.log("[Worker/Migrating] Asking if a server is available.", { context })
        }
        return lookup.pipe(
            switchMap(lookup => {
                lookup.next({
                    type: "askIfServerIsAvailable"
                })
                return lookup.pipe(
                    mergeMap(message => {
                        if (message.type === "newServerStarted" || message.type === "serverIsAvailable") {
                            if (log) {
                                console.log("[Worker/Migrating] Got first message from lookup channel.", { context, message })
                            }
                            return of(message.channelId)
                        }
                        else {
                            return EMPTY
                        }
                    }),
                    first(),
                    mergeWith(lookup.pipe(
                        mergeMap(message => {
                            if (message.type === "newServerStarted") {
                                if (log) {
                                    console.log("[Worker/Migrating] A new server has started.", { context, message })
                                }
                                return of(message.channelId)
                            }
                            else {
                                return EMPTY
                            }
                        })
                    ))
                )
            })
        )
    })
}
