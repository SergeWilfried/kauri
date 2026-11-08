import { Inbox } from '@novu/react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

/**
 * Novu notification inbox for the signed-in staff member, one subscriber per `users._id`. Renders nothing until an active user is loaded.
 */
function Novu() {
  const me = useQuery(api.users.me)
  if (!me?.active) return null
  return (
    <Inbox
      applicationIdentifier="mLtXHnJfZNRB"
      subscriberId={me.id}
      socketUrl="wss://socket.novu.co"
      appearance={{
        variables: {
          colorPrimary: "#DD2450",
          colorForeground: "#0E121B"
        }
      }}
    />
  )
}

export default Novu
