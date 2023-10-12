# Observable Worker

## Installation

## Usage

In the main file:

```
import { wrapWorker } from "observable-worker"
import { Observable } from "rxjs"

type WorkerService = {

    observeValue(): Observable<number>
    getValue(): Promise<number>

}

const worker = wrapWorker<WorkerService>(new URL("/src/app/DedicatedWorker.ts", import.meta.url), { type: 'module' })
worker.observeValue().observe().subscribe(value => {
    console.log("Got a value: " + value + ".)
})
worker.getValue().execute().then(value => {
    console.log("Got a value: " + value + ".)
})
```

In the worker file:

```
import { exposeSelf } from "observable-worker"
import { interval, map } from "rxjs"

exposeSelf({
    target: {
        observeValue() {
            return interval(500).pipe(map(() => Math.random()))
        }
    }
})
```

## License

[MIT](https://choosealicense.com/licenses/mit/)