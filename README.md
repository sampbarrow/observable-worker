# React Intercept

A generic react HOC, intended for composition. Allows you to create flexible chains of HOCs.

## Installation

```bash
npm install react-intercept
```

## Usage

```typescript
import { intercept } from "react-intercept"
import { compose } from "ramda"

type User = {
 id: string
 name: string
}
const UserContext = React.createContext<User | undefined>(undefined)
function loadUser(userId: string) {
 return {
  id: userId,
  name: "This is fake."
 }
}
type MyComponentProps = {
 userId: string | undefined
}
const MyComponent = compose(
 intercept((props: MyComponentProps)) => {
  if (props.userId === undefined) {
   return <Fragment>You are not logged in.</Fragment>
  }
  const pass = {
    user: loadUser(props.userId)
  }
  return (Component: ComponentType<typeof pass>) => <Component user={user} />
 }
 intercept(props => {
  if (props.user.name === "This is fake.") {
   return <Fragment>You are not real.</Fragment>
  }
  return Component => <UserContext value={props.user}><Component /></UserContext>
 })
)(() => {
 return <Fragment>Do stuff.</Fragment>
})

```

## License

[MIT](https://choosealicense.com/licenses/mit/)