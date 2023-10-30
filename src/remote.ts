import { Observable, map, of } from "rxjs"
import { Proxied, Target } from "./processing"
import { CallOptions, Sender } from "./sender"
import { callOnTarget, proxy } from "./util"

export interface Remote<T extends Target> {

    readonly proxy: Proxied<T>
    watch(autoReconnect?: boolean | undefined): Observable<Proxied<T>>
    options(options: CallOptions): Remote<T>
    close(): void

}

export class SenderRemote<T extends Target> implements Remote<T>  {

    readonly proxy

    constructor(private readonly sender: Sender) {
        this.proxy = proxySender<T>(this.sender)
    }

    watch(autoReconnect?: boolean | undefined) {
        return this.sender.watch(autoReconnect).pipe(map(sender => proxySender<T>(sender)))
    }
    options(options: CallOptions) {
        return new SenderRemote<T>(this.sender.withOptions(options))
    }
    close() {
        return this.sender.close()
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

    watch(): Observable<Proxied<T>> {
        return of(this.proxy)
    }
    options(): Remote<T> {
        return this
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
