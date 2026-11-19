#!/usr/bin/env node
/**
 * Migrate existing project files from local PROJECT_PATH to MinIO.
 *
 * - Reads PROJECT_PATH (default ./data/projects); each direct subdir = projectId.
 * - Uploads every file to MinIO with object key: {projectId}/{relativePath}.
 * - Uses same bucket and key layout as lib/storage/storage-minio.js.
 * - Writes a report to scripts/migrate-to-minio-report.json.
 *
 * Prerequisites:
 *   - MinIO running (e.g. localhost:9000).
 *   - .env has USE_MINIO, MINIO_*, MINIO_BUCKET (or defaults).
 *
 * Run from genlatex root:
 *   node scripts/migrate-to-minio.js
 *   node scripts/migrate-to-minio.js --dry-run   # list only, no upload
 */

import 'dotenv/config';
import * as Minio from 'minio';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const basePath = process.env.PROJECT_PATH || './data/projects';
const bucket = process.env.MINIO_BUCKET || 'genlatex-projects';
const resolvedBase = path.resolve(rootDir, basePath);

const dryRun = process.argv.includes('--dry-run');

function getClient() {
  const useSSL = process.env.MINIO_USE_SSL === 'true';
  return new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL,
    accessKey: process.env.MINIO_ACCESS_KEY || '',
    secretKey: process.env.MINIO_SECRET_KEY || '',
  });
}

function objectKey(projectId, relativePath) {
  const normalized = path.normalize(relativePath).replace(/\\/g, '/').replace(/^(\.\.(\/|$))+/, '');
  return normalized ? `${projectId}/${normalized}` : `${projectId}/`;
}

/**
 * Recursively list all files in a directory (relative paths).
 * @param {string} dir - Absolute path to directory
 * @param {string} prefix - Relative path prefix (e.g. '' or 'template')
 * @returns {Promise<Array<{ relativePath: string, absolutePath: string }>>}
 */
async function listFilesRecursive(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const name = e.name;
    if (name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    const abs = path.join(dir, name);
    if (e.isDirectory()) {
      files.push(...(await listFilesRecursive(abs, rel)));
    } else {
      files.push({ relativePath: rel, absolutePath: abs });
    }
  }
  return files;
}

async function ensureBucket(client) {
  try {
    const exists = await client.bucketExists(bucket);
    if (!exists) {
      await client.makeBucket(bucket, 'us-east-1');
      console.log(`[MinIO] Bucket "${bucket}" created`);
    }
  } catch (err) {
    throw new Error(`Bucket check/create failed: ${err.message}`);
  }
}

/**
 * Migrate one project: upload all files under projectDir to MinIO with prefix projectId/.
 */
async function migrateProject(client, projectId, projectDir) {
  const files = await listFilesRecursive(projectDir);
  const results = { uploaded: 0, errors: [] };
  for (const { relativePath, absolutePath } of files) {
    try {
      if (!dryRun) {
        const buf = await fs.readFile(absolutePath);
        const key = objectKey(projectId, relativePath);
        await client.putObject(bucket, key, buf, buf.length);
      }
      results.uploaded++;
    } catch (err) {
      results.errors.push({ relativePath, message: err.message });
    }
  }
  return results;
}

async function main() {
  console.log('Migration: local project files → MinIO');
  console.log('  PROJECT_PATH:', basePath);
  console.log('  Resolved base:', resolvedBase);
  console.log('  Bucket:', bucket);
  console.log('  Dry run:', dryRun);
  console.log('');

  const report = {
    startedAt: new Date().toISOString(),
    dryRun,
    basePath: resolvedBase,
    bucket,
    projects: [],
    totalFiles: 0,
    totalErrors: 0,
    errors: [],
  };

  let client;
  if (!dryRun) {
    client = getClient();
    await ensureBucket(client);
  } else {
    client = null;
  }

  let projectDirs;
  try {
    projectDirs = await fs.readdir(resolvedBase, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No project directory found at', resolvedBase);
      console.log('Create it and add project folders, or set PROJECT_PATH in .env');
      process.exit(1);
    }
    throw err;
  }

  const projectIds = projectDirs.filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
  console.log(`Found ${projectIds.length} project(s)\n`);

  for (const projectId of projectIds) {
    const projectDir = path.join(resolvedBase, projectId);
    const stat = await fs.stat(projectDir).catch(() => null);
    if (!stat || !stat.isDirectory()) continue;
    process.stdout.write(`  ${projectId} ... `);
    const result = await migrateProject(client, projectId, projectDir);
    report.projects.push({
      projectId,
      filesUploaded: result.uploaded,
      errors: result.errors,
    });
    report.totalFiles += result.uploaded;
    report.totalErrors += result.errors.length;
    for (const e of result.errors) {
      report.errors.push({ projectId, relativePath: e.relativePath, message: e.message });
    }
    if (result.errors.length) {
      console.log(`${result.uploaded} ok, ${result.errors.length} error(s)`);
    } else {
      console.log(`${result.uploaded} file(s)`);
    }
  }

  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(__dirname, 'migrate-to-minio-report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\nReport written to:', reportPath);
  console.log('Total files:', report.totalFiles);
  if (report.totalErrors) {
    console.log('Total errors:', report.totalErrors);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
