export const checkAuth = (request: Request, env) => {
  if (!env.DEMO_USERNAME || !env.DEMO_PASSWORD) return false
  if (checkBasicAuth(request, env)) return true
  if (checkQueryParams(request, env)) return true
  return false
}

const checkBasicAuth = (request: Request, env) => {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return false
  const [username, password] = atob(authHeader.split(' ')[1]).split(':')
  return username === env.DEMO_USERNAME && password === env.DEMO_PASSWORD
}

const checkQueryParams = (request: Request, env) => {
  const url = new URL(request.url)
  const username = url.searchParams.get('username')
  const password = url.searchParams.get('password')
  return username === env.DEMO_USERNAME && password === env.DEMO_PASSWORD
}
