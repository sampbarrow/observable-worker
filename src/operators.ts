import { Observable, OperatorFunction, first, merge, skip, switchMap, throwError } from "rxjs"

export function singleOrError<T>(error?: () => unknown) {
    return (observable: Observable<T>) => {
        return merge(
            observable.pipe(
                skip(1),
                switchMap(() => {
                    return throwError(() => error?.() ?? new Error("Received a second emission from a single observable."))
                })
            ),
            observable.pipe(first())
        )
    }
}

export function optional<I, O>(options?: OperatorFunction<I, O> | undefined) {
    return (observable: Observable<I>) => {
        if (options !== undefined) {
            return observable.pipe(options)
        }
        return observable
    }
}
