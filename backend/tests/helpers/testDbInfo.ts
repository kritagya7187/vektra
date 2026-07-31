import { readFileSync } from 'node:fs';
import { CONNECTION_INFO_PATH, type TestDbConnectionInfo } from './globalSetup';

/** Single read of globalSetup's connection-info file, reused by every helper that needs it. */
export const testDbInfo = JSON.parse(
  readFileSync(CONNECTION_INFO_PATH, 'utf8'),
) as TestDbConnectionInfo;
