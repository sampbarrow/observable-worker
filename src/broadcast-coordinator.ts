import { EMPTY, ObservableNotification, combineLatest, filter, first, ignoreElements, map, merge, mergeMap, of, startWith, switchMap, tap } from "rxjs"
import { BatcherOptions } from "./batcher"
import { Channel } from "./channel"
import { Answer, Call } from "./processing"
import { generateId, holdWebLock, onWebLockAvailable, randomLock } from "./util"

export const DEFAULT_CONTEXT = "default"

export interface BroadcastCoordinatorOptions {

    readonly context?: string

}

export function broadcastFinder(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastFinder(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.dualBroadcast(id1, id2))
}
export function broadcastAdvertiser(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastAdvertiser(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.dualBroadcast(id1, id2))
}

export interface BroadcastCoordinatorBatchingOptions {

    readonly context?: string
    readonly batcher?: BatcherOptions

}

export function broadcastFinderBatching(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastFinder(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.batching(Channel.dualBroadcast(id1, id2)))
}
export function broadcastAdvertiserBatching(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastAdvertiser(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.batching(Channel.dualBroadcast(id1, id2)))
}

type BroadcastChannelCreator = <I, O>(id1: string, id2: string) => Channel<I, O>

function buildBroadcastAdvertiser(context: string, createBroadcastChannel: BroadcastChannelCreator) {
    return holdWebLock(context).pipe(
        switchMap(() => {
            const registrationChannelId = generateId()
            const registration = Channel.broadcast<RegistrationMessage>(registrationChannelId)
            return merge(
                combineLatest([
                    Channel.broadcast<LookupMessage>(context),
                    randomLock("registration-")
                ]).pipe(
                    switchMap(([lookupConnection, lockId]) => {
                        return lookupConnection.pipe(
                            filter(message => message.type === "askIfServerIsAvailable"),
                            map(() => {
                                return {
                                    type: "serverIsAvailable" as const,
                                    registrationChannelId,
                                    lockId
                                }
                            }),
                            startWith({
                                type: "newServerStarted" as const,
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
                                return onWebLockAvailable(message.lockId).pipe(
                                    map(() => {
                                        return {
                                            action: "delete" as const,
                                            key: message.clientId,
                                        }
                                    }),
                                    startWith({
                                        action: "add" as const,
                                        key: message.clientId,
                                        observable: createBroadcastChannel<Call, ObservableNotification<Answer>>(message.callChannelId, message.answerChannelId)
                                    })
                                )
                            }),
                        )
                    })
                )
            )
        })
    )
}

function buildBroadcastFinder(context: string, createBroadcastChannel: BroadcastChannelCreator) {
    return Channel.broadcast<LookupMessage>(context).pipe(
        switchMap(lookup => {
            lookup.next({
                type: "askIfServerIsAvailable"
            })
            return lookup.pipe(
                mergeMap(message => message.type === "newServerStarted" || message.type === "serverIsAvailable" ? of(message) : EMPTY),
                first(),
                switchMap(message => {
                    return merge(
                        of(message),
                        lookup.pipe(mergeMap(message => message.type === "newServerStarted" ? of(message) : EMPTY))
                    )
                }),
                switchMap(server => {
                    return randomLock("client-").pipe(
                        switchMap(lockId => {
                            const registration = Channel.broadcast<RegistrationMessage>(server.registrationChannelId)
                            return registration.pipe(
                                switchMap(registration => {
                                    const clientId = generateId()
                                    const callChannelId = generateId()
                                    const answerChannelId = generateId()
                                    //TODO try to ensure proper priorities or just rely on locks?
                                    registration.next({
                                        type: "registerClient",
                                        clientId,
                                        lockId,
                                        callChannelId,
                                        answerChannelId,
                                    })
                                    return merge(
                                        onWebLockAvailable(server.lockId).pipe(map(() => undefined)),
                                        registration.pipe(
                                            filter(message => message.type === "clientRegistered" && message.clientId === clientId),
                                            first(),
                                            switchMap(() => {
                                                return createBroadcastChannel<ObservableNotification<Answer>, Call>(answerChannelId, callChannelId)
                                            })
                                        )
                                    )
                                })
                            )
                        })
                    )
                })
            )
        })
    )
}

/**
 * Lookup
 */

type LookupMessage = AskIfServerIsAvailableMessage | NewServerStartedMessage | ServerIsAvailableMessage

type AskIfServerIsAvailableMessage = {
    readonly type: "askIfServerIsAvailable"
}

type NewServerStartedMessage = {
    readonly type: "newServerStarted"
    readonly registrationChannelId: string
    readonly lockId: string
}

type ServerIsAvailableMessage = {
    readonly type: "serverIsAvailable"
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
