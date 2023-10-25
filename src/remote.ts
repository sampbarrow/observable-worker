import { Observable, of } from "rxjs"
import { Proxied, Target } from "./processing"
import { CallOptions, Sender } from "./sender"
import { callOnTarget, proxy } from "./util"

export interface Remote<T extends Target> {

    readonly proxy: Proxied<T>

    connected(): Observable<void>
    close(): void
    withOptions(options: CallOptions): Remote<T>

}

export class SenderRemote<T extends Target> implements Remote<T> {

    readonly proxy

    constructor(private readonly sender: Sender) {
        this.proxy = proxy<Sender, Proxied<T>>(sender, {
            get(target, key) {
                if (typeof key === "symbol") {
                    throw new Error("No symbol calls on a proxy.")
                }
                return (...args: unknown[]) => target.call(key, ...args)
            }
        })
    }

    connected() {
        return this.sender.connected()
    }
    close() {
        return this.sender.close()
    }
    withOptions(options: CallOptions) {
        return new SenderRemote<T>(this.sender.withOptions(options))
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

    connected() {
        return of(void 0)
    }
    close() {
    }
    withOptions() {
        return this
    }

}
