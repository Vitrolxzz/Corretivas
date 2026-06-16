const apiBase = import.meta.env.VITE_API_BASE_URL || '';

async function parseResponse(response) {
  if (response.status === 204) {
    return null;
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Falha na comunicacao com o servidor.');
  }

  return data;
}

export async function request(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  };

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return parseResponse(response);
}

export function eventSource() {
  return new EventSource(`${apiBase}/api/events`);
}

export function correctiveExportUrl(periodId) {
  const params = periodId ? `?periodId=${encodeURIComponent(periodId)}` : '';
  return `${apiBase}/api/export/correctives.csv${params}`;
}

export function exportUrl(resource, format, params = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') {
      query.set(key, value);
    }
  }

  const suffix = query.toString() ? `?${query}` : '';
  return `${apiBase}/api/export/${resource}.${format}${suffix}`;
}

export function photoDownloadUrl(photoId, resource = 'turnstiles') {
  return `${apiBase}/api/${resource}/photos/${encodeURIComponent(photoId)}/download`;
}

function resolvePhotoUrl(value) {
  const path = String(value || '').trim();

  if (!path || path.startsWith('gs://')) {
    return '';
  }

  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path;
  }

  if (path.startsWith('/')) {
    return `${apiBase.replace(/\/$/, '')}${path}`;
  }

  return path;
}

export function photoImageUrl(photo) {
  return resolvePhotoUrl(photo?.publicPath) || resolvePhotoUrl(photo?.publicUrl);
}
