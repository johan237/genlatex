/**
 * GenLaTeX – Storage factory
 * Returns FS or MinIO implementation based on USE_MINIO env.
 */

import * as storageFs from './storage-fs.js';
import * as storageMinio from './storage-minio.js';

const USE_MINIO = process.env.USE_MINIO === 'true';

function getStorage() {
  return USE_MINIO ? storageMinio : storageFs;
}

export function getProjectPath(userId, projectId) {
  return getStorage().getProjectPath(userId, projectId);
}

export function ensureProjectDir(userId, projectId) {
  return getStorage().ensureProjectDir(userId, projectId);
}

export function readTextFile(userId, projectId, filename) {
  return getStorage().readTextFile(userId, projectId, filename);
}

export function writeTextFile(userId, projectId, filename, content) {
  return getStorage().writeTextFile(userId, projectId, filename, content);
}

export async function readFile(projectId, relativePath, options) {
  return getStorage().readFile(projectId, relativePath, options);
}

export async function writeFile(projectId, relativePath, content) {
  return getStorage().writeFile(projectId, relativePath, content);
}

export async function fileExists(projectId, relativePath) {
  return getStorage().fileExists(projectId, relativePath);
}

export async function listDir(projectId, subdir) {
  return getStorage().listDir(projectId, subdir ?? '');
}

export async function deleteProjectFiles(userId, projectId) {
  return getStorage().deleteProjectFiles(userId, projectId);
}

export async function atomicWriteFileByPath(filePath, content, encoding) {
  return getStorage().atomicWriteFileByPath(filePath, content, encoding);
}

export async function syncProjectToLocal(projectId) {
  return getStorage().syncProjectToLocal(projectId);
}

export async function syncProjectFromLocal(projectId) {
  return getStorage().syncProjectFromLocal(projectId);
}

export async function deleteFile(projectId, relativePath) {
  return getStorage().deleteFile(projectId, relativePath);
}

export async function deleteFolder(projectId, relativeDirPath) {
  return getStorage().deleteFolder(projectId, relativeDirPath);
}

export async function renameFile(projectId, oldPath, newPath) {
  return getStorage().renameFile(projectId, oldPath, newPath);
}

export async function copyFile(projectId, srcPath, destPath) {
  return getStorage().copyFile(projectId, srcPath, destPath);
}

export async function deleteFileByPath(filePath) {
  return getStorage().deleteFileByPath(filePath);
}

export function isMinio() {
  return getStorage().isMinio();
}

export async function getProjectStorageSize(projectId) {
  return getStorage().getProjectStorageSize(projectId);
}
