import { Observable, map } from "rxjs"
import { Proxied, Target } from "./processing"
import { Sender, VolatileCallOptions, VolatileSender } from "./sender"
import { callOnTarget, proxy } from "./util"

export interface Remote<T extends Target> {

    readonly proxy: Proxied<T>
    close(): void

}

export class SenderRemote<T extends Target> implements Remote<T> {

    readonly proxy

    constructor(private readonly sender: Sender) {
        this.proxy = proxySender<T>(this.sender)
    }
    close(): void {
        return this.sender.close()
    }

}

export interface VolatileRemote<T extends Target> extends Remote<T>, Observable<Proxied<T>> {

    readonly proxy: Proxied<T>
    withOptions(options: VolatileCallOptions): VolatileRemote<T>

}

export class VolatileSenderRemote<T extends Target> extends Observable<Proxied<T>> implements VolatileRemote<T>  {

    readonly proxy

    constructor(private readonly sender: VolatileSender) {
        super(subscriber => {
            return this.sender.watch().pipe(map(sender => proxySender<T>(sender))).subscribe(subscriber)
        })
        this.proxy = proxyVolatileSender<T>(this.sender)
    }

    close() {
        return this.sender.close()
    }
    withOptions(options: VolatileCallOptions) {
        return new VolatileSenderRemote<T>(this.sender.withOptions(options))
    }

}

export class MockRemote<T extends Target> implements Remote<T> {

    readonly proxy

    constructor(object: T) {
        this.proxy = proxy<T, Proxied<T>>(object, {
            get(target, key) {
                if (typeof key === "symbol") {
                    throw new Error("No symbol calls on a proxy.")
                }
                return (...args: unknown[]) => callOnTarget(target, key, args)
            }
        })
    }

    close() {
    }

}

function proxySender<T extends Target>(sender: Sender) {
    return proxy<Sender, Proxied<T>>(sender, {
        get(target, key) {
            if (typeof key === "symbol") {
                throw new Error("No symbol calls on a proxy.")
            }
            return (...args: unknown[]) => target.call(key, ...args)
        }
    })
}

function proxyVolatileSender<T extends Target>(sender: VolatileSender) {
    return proxy<VolatileSender, Proxied<T>>(sender, {
        get(target, key) {
            if (typeof key === "symbol") {
                throw new Error("No symbol calls on a proxy.")
            }
            if (key.endsWith("AsObservable")) {
                //TODO make a universal "autoretry" that does both obs and promises
                return (...args: unknown[]) => target.withOptions({ autoRetryPromises: true }).call(key, ...args)
            }
            else {
                return (...args: unknown[]) => target.call(key, ...args)
            }
        }
    })
}
