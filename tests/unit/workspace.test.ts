import { describe, it, expect } from 'vitest';
import { getWorkspaceId } from '../../src/shared/workspace';

describe('getWorkspaceId', () => {
  it('extracts workspace ID from app.slack.com URL', () => {
    expect(
      getWorkspaceId('https://app.slack.com/client/T0123456789/C987654321')
    ).toBe('T0123456789');
  });

  it('extracts workspace ID from app.slack.com URL with path segments', () => {
    expect(
      getWorkspaceId('https://app.slack.com/client/T0123456789/C987654321/thread/C987654321-1234567890.123456')
    ).toBe('T0123456789');
  });

  it('extracts workspace subdomain from workspace.slack.com URL', () => {
    expect(getWorkspaceId('https://myteam.slack.com/messages/general')).toBe(
      'myteam'
    );
  });

  it('returns null for app.slack.com without client path', () => {
    expect(getWorkspaceId('https://app.slack.com/')).toBeNull();
  });

  it('returns null for non-Slack URLs', () => {
    expect(getWorkspaceId('https://example.com')).toBeNull();
  });

  it('returns null for bare slack.com', () => {
    expect(getWorkspaceId('https://slack.com/')).toBeNull();
  });
});
