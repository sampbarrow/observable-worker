import { Observable } from "rxjs"
import { Input, ObservableMembers, Output, PromiseMembers, Target } from "./processing"

export type NewRemote<T extends Target> = {

    observe<K extends keyof ObservableMembers<T>>(key: K, ...args: Input<ObservableMembers<T>[K]>): Output<ObservableMembers<T>[K]>
    execute<K extends keyof PromiseMembers<T>>(key: K, ...args: Input<PromiseMembers<T>[K]>): Output<PromiseMembers<T>[K]>

}

//TODO this solves browser issues
type XX = NewRemote<{ a: (a: boolean) => string, b: () => Observable<number> }>
const yy: XX = "" as any
yy.execute("a", false)