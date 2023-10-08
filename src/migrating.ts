
import { EMPTY, MonoTypeOperatorFunction, Subscription, defer, filter, first, map, mergeMap, mergeWith, of, switchMap } from "rxjs"
import { Channel } from "./channel"
import { DirectReceiver } from "./direct"
import { AutoRetryOptions, LazySender } from "./lazy"
import { Answer, Call, Target, proxy } from "./processing"
import { acquireWebLock, generateId, observeWebLock } from "./util"
import { Wrap } from "./wrap"

export function registerWithServer(channelId: string, log?: boolean) {
    return defer(() => {
        if (log) {
            console.log("[Worker/Migration] Registering with server over registration channel " + channelId + ".")
        }
        const lockId = generateId()
        return observeWebLock(lockId).pipe(
            mergeMap(() => {
                const registration = Channel.broadcast<RegistrationMessage>(channelId).open()//TODO when to close? also unregister
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
}

export function findAndRegisterWithServer(context: string = DEFAULT_CONTEXT, log?: boolean) {
    return findServer(context, log).pipe(
        switchMap(channelId => {
            return registerWithServer(channelId, log)
        }),
        map(channelIds => {
            const calls = Channel.batching(Channel.broadcast<Call[]>(channelIds.callChannelId))
            const answers = Channel.batching(Channel.broadcast<Answer[]>(channelIds.answerChannelId))
            return Channel.combine(answers, calls)
        })
    )
}

export function findServer(context: string = DEFAULT_CONTEXT, log?: boolean) {
    return defer(() => {
        //TODO close
        const lookup = Channel.broadcast<LookupMessage>(context).open()
        if (log) {
            console.log("[Worker/Migrating] Asking if a server is available.", { context })
        }
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
}

export const DEFAULT_CONTEXT = "default"

export type LookupMessage = {
    type: "askIfServerIsAvailable"
} | {
    type: "newServerStarted"
    channelId: string
} | {
    type: "serverIsAvailable"
    channelId: string
}

export type RegistrationMessage = {
    type: "registerClient"
    clientId: string
    lockId: string
    callChannelId: string
    answerChannelId: string
} | {
    type: "clientRegistered"
    clientId: string
}

type RegisterServerConfig<T extends Target> = {

    target: T
    context?: string
    log?: boolean

}

function lookupListen(context: string, registrationChannelId: string, log?: boolean) {
    const lookup = Channel.broadcast<LookupMessage>(context).open()
    const sub = lookup.subscribe(message => {
        if (message.type === "askIfServerIsAvailable") {
            if (log) {
                console.log("[Worker/Migrating] Received a server availability check on the lookup channel.", { context })
            }
            lookup.next({
                type: "serverIsAvailable",
                channelId: registrationChannelId
            })
        }
    })
    if (log) {
        console.log("[Worker/Migrating] Sending a server started message on the lookup channel.", { context })
    }
    lookup.next({
        type: "newServerStarted",
        channelId: registrationChannelId
    })
    return {
        close: () => {
            sub.unsubscribe()
            lookup.close()
        }
    }
}

export async function exposeMigrating<T extends Target>(config: RegisterServerConfig<T>) {

    const context = config.context ?? DEFAULT_CONTEXT
    const clients = new Map<string, Subscription>()
    const registrationId = generateId()

    const close = await acquireWebLock(context)

    if (config.log) {
        console.log("[Worker/Migrating] Exposing a migrating service. Starting a registration channel at " + registrationId + ".", { context })
    }

    const registration = Channel.broadcast<RegistrationMessage>(registrationId).open()
    registration.subscribe(message => {

        if (config.log) {
            console.log("[Worker/Migrating] Received a message on registration channel " + registrationId + ".", message)
        }

        if (message.type === "registerClient") {

            if (config.log) {
                console.log("[Worker/Migrating] Received a registration request from client " + message.clientId + ".")
                console.log("[Worker/Migrating] Starting a receiver on call channel " + message.callChannelId + " and answer channel " + message.answerChannelId + ".")
            }

            const channel = Channel.batching<Call, Answer>(Channel.dualBroadcast(message.callChannelId, message.answerChannelId))
            const receiver = new DirectReceiver({
                channel,
                target: config.target,
                log: config.log,
            })
            const sup = receiver.subscribe()

            //TODO client should be able to disconnect without necessarily releasing their lock
            //also stop listening to this if the expose is closed
            acquireWebLock(message.lockId).then(() => {
                sup.unsubscribe()
                clients.delete(message.clientId)
            })

            clients.set(message.clientId, sup)

            if (config.log) {
                console.log("[Worker/Migrating] Sending registration confirmation to client " + message.clientId + ".")
            }
            registration.next({
                type: "clientRegistered",
                clientId: message.clientId
            })

        }

    })

    const lookup = lookupListen(context, registrationId)

    return {
        close: () => {
            lookup.close()
            registration.close()
            close()
        }
    }

}

export interface MigratingWrapConfig extends AutoRetryOptions {

    context?: string
    pipe?: MonoTypeOperatorFunction<Channel<Answer, Call>>
    log?: boolean

}

export function wrapMigrating<T extends Target>(config: MigratingWrapConfig = {}): Wrap<T> {
    const s = findAndRegisterWithServer(config.context, config.log).pipe(config.pipe ?? (_ => _))
    const sender = new LazySender({ ...config, channel: s, log: config.log })
    return {
        remote: proxy<T>(sender),
        close: () => sender.close()
    }
}
