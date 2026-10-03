export function sourceSession(): string {
  const key='slidev-studio:text-session'
  let value=sessionStorage.getItem(key)
  if(!value){value=crypto.randomUUID();sessionStorage.setItem(key,value)}
  return value
}
