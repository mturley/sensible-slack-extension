import {
  SLACK_WORKSPACE_URL_PATTERN,
  SLACK_SUBDOMAIN_PATTERN,
} from './constants';

export function getWorkspaceId(url: string): string | null {
  const appMatch = url.match(SLACK_WORKSPACE_URL_PATTERN);
  if (appMatch) return appMatch[1];

  const subdomainMatch = url.match(SLACK_SUBDOMAIN_PATTERN);
  if (subdomainMatch && subdomainMatch[1] !== 'app') {
    return subdomainMatch[1];
  }

  return null;
}

export function getWorkspaceIdFromCurrentPage(): string | null {
  return getWorkspaceId(window.location.href);
}
