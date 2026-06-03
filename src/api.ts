export async function authFetch(url: string, options: any = {}) {
  const token = localStorage.getItem('token');
  const tenantId = localStorage.getItem('tenantId') || '1'; // Default to 1 if not set

  const headers: any = {
    ...options.headers,
    'Authorization': token ? `Bearer ${token}` : '',
    'x-tenant-id': tenantId,
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = options.headers?.['Content-Type'] || 'application/json';
  }

  return fetch(url, {
    ...options,
    headers,
  });
}
