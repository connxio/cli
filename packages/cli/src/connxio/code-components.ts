import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { ZipFile } from "yazl";

import type { ConnxioClient } from "./client.js";

const DEFAULT_COMPONENT_TYPE = "Map";
const ZIP_TEMP_DIR_PREFIX = "connxio-code-component-";

type CodeComponentClient = Pick<ConnxioClient, "get" | "put">;

type CodeComponentRecord = {
  componentOriginalFilename: string | null;
  id: string;
  name: string;
  sasUri: string | null;
  type: string | null;
  version: string | null;
};

export type UploadCodeComponentInput = {
  autoZip?: boolean;
  filePath: string;
  name: string;
  type?: string;
  version?: string;
};

export type UploadCodeComponentResult = {
  apiResult: unknown;
  autoZipped: boolean;
  componentId: string;
  name: string;
  previousVersion: string | null;
  resolvedVersion: string;
  sourceFilePath: string;
  uploadedFilePath: string;
  uploadedFilename: string;
  uploadedFileType: "dll" | "zip";
  warnings: string[];
};

export type UpdateComponentInIntegrationInput = {
  componentName: string;
  integrationId: string;
  newVersion: string;
  oldVersion: string;
};

export type UpdateComponentInIntegrationResult = {
  componentId: string | null;
  componentName: string;
  integrationId: string;
  result: unknown;
  updated: boolean;
};

export async function uploadCodeComponent(
  client: CodeComponentClient,
  input: UploadCodeComponentInput,
): Promise<UploadCodeComponentResult> {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Code component name cannot be empty.");
  }

  const requestedVersion = normalizeOptionalString(input.version);
  const requestedType = normalizeOptionalString(input.type);
  const sourceFilePath = resolveLocalPath(input.filePath);
  const sourceFileType = await getUploadFileType(sourceFilePath);
  const existingComponent = await findCodeComponentByName(client, name);
  const previousVersion = existingComponent
    ? await getLatestComponentVersion(client, existingComponent)
    : null;
  const resolvedVersion =
    requestedVersion ?? incrementVersion(previousVersion ?? "1.0.0", !previousVersion);
  const componentId = existingComponent?.id ?? randomUUID();
  const componentType = requestedType ?? existingComponent?.type ?? DEFAULT_COMPONENT_TYPE;
  const warnings = collectFileTypeWarnings(existingComponent, sourceFileType, input.autoZip);

  let uploadFilePath = sourceFilePath;
  let tempDirectoryPath: string | undefined;
  const autoZipped =
    sourceFileType === "dll" && shouldAutoZip(existingComponent, sourceFileType, input.autoZip);

  try {
    if (autoZipped) {
      const archive = await createUploadArchive(sourceFilePath);
      uploadFilePath = archive.filePath;
      tempDirectoryPath = archive.tempDirectoryPath;
    }

    const uploadBuffer = await readFile(uploadFilePath);
    const uploadedFilename = basename(uploadFilePath);
    const uploadedFileType = getFileTypeFromExtension(uploadFilePath);
    const apiResult = await client.put("/v2/codecomponents", {
      body: {
        componentOriginalFilename: uploadedFilename,
        id: componentId,
        mappingDll: uploadBuffer.toString("base64"),
        name,
        type: componentType,
        version: resolvedVersion,
      },
    });

    return {
      apiResult,
      autoZipped,
      componentId,
      name,
      previousVersion,
      resolvedVersion,
      sourceFilePath,
      uploadedFilePath: uploadFilePath,
      uploadedFilename,
      uploadedFileType,
      warnings,
    };
  } finally {
    if (tempDirectoryPath) {
      await rm(tempDirectoryPath, { force: true, recursive: true });
    }
  }
}

export async function updateComponentInIntegration(
  client: CodeComponentClient,
  input: UpdateComponentInIntegrationInput,
): Promise<UpdateComponentInIntegrationResult> {
  const integrationId = input.integrationId.trim();
  const componentName = input.componentName.trim();
  const oldVersion = input.oldVersion.trim();
  const newVersion = input.newVersion.trim();

  if (!integrationId) {
    throw new Error("Integration id cannot be empty.");
  }

  if (!componentName) {
    throw new Error("Code component name cannot be empty.");
  }

  if (!oldVersion || !newVersion) {
    throw new Error("Both oldVersion and newVersion are required.");
  }

  const integration = await client.get(`/v2/integrations/${encodeURIComponent(integrationId)}`);

  if (!isRecord(integration)) {
    throw new Error(`Integration ${integrationId} was not found.`);
  }

  const existingComponent = await findCodeComponentByName(client, componentName);
  const nextIntegration = JSON.parse(JSON.stringify(integration)) as unknown;
  const matchTerms = [existingComponent?.id, componentName].filter((value): value is string =>
    Boolean(value),
  );
  const updated = replaceComponentVersion(
    nextIntegration,
    matchTerms,
    oldVersion,
    newVersion,
    existingComponent?.sasUri ? { newSasUri: existingComponent.sasUri } : {},
  );

  if (!updated) {
    return {
      componentId: existingComponent?.id ?? null,
      componentName,
      integrationId,
      result: null,
      updated: false,
    };
  }

  const result = await client.put(`/v2/integrations/${encodeURIComponent(integrationId)}`, {
    body: nextIntegration,
  });

  return {
    componentId: existingComponent?.id ?? null,
    componentName,
    integrationId,
    result,
    updated: true,
  };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function resolveLocalPath(filePath: string): string {
  const normalized = filePath.trim();

  if (!normalized) {
    throw new Error("filePath cannot be empty.");
  }

  return isAbsolute(normalized) ? normalized : resolve(normalized);
}

async function getUploadFileType(filePath: string): Promise<"dll" | "zip"> {
  let fileStats;

  try {
    fileStats = await stat(filePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Code component file not found: ${filePath}. ${message}`);
  }

  if (!fileStats.isFile()) {
    throw new Error(`Code component path is not a file: ${filePath}`);
  }

  return getFileTypeFromExtension(filePath);
}

function getFileTypeFromExtension(filePath: string): "dll" | "zip" {
  const extension = extname(filePath).toLowerCase();

  if (extension === ".dll") {
    return "dll";
  }

  if (extension === ".zip") {
    return "zip";
  }

  throw new Error(
    `Unsupported code component file type: ${filePath}. Only .dll and .zip are supported.`,
  );
}

async function findCodeComponentByName(
  client: CodeComponentClient,
  name: string,
): Promise<CodeComponentRecord | undefined> {
  const codeComponents = await client.get("/v2/codecomponents");

  if (!Array.isArray(codeComponents)) {
    throw new Error("Connxio code components response was not an array.");
  }

  const normalizedName = name.toLowerCase();

  return codeComponents
    .map(parseCodeComponentRecord)
    .find((component) => component?.name.toLowerCase() === normalizedName);
}

async function getLatestComponentVersion(
  client: CodeComponentClient,
  component: CodeComponentRecord,
): Promise<string | null> {
  const versionsResponse = await client.get(
    `/v2/codecomponents/${encodeURIComponent(component.id)}/versions`,
  );
  const versionCandidates = Array.isArray(versionsResponse)
    ? versionsResponse.map(readVersionValue).filter((version) => version !== undefined)
    : [];

  if (component.version) {
    versionCandidates.push(component.version);
  }

  return pickLatestVersion(versionCandidates) ?? null;
}

function readVersionValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.version === "string") {
    return value.version;
  }

  if (typeof value.Version === "string") {
    return value.Version;
  }

  return undefined;
}

function pickLatestVersion(versions: string[]): string | undefined {
  if (versions.length === 0) {
    return undefined;
  }

  const parsedVersions = versions
    .map((version) => ({ parsed: parseVersion(version), version }))
    .filter((item): item is { parsed: number[]; version: string } => item.parsed !== undefined);

  if (parsedVersions.length === 0) {
    return versions[0];
  }

  parsedVersions.sort((left, right) => compareVersionParts(right.parsed, left.parsed));
  return parsedVersions[0]?.version;
}

function incrementVersion(version: string, isInitialVersion = false): string {
  if (isInitialVersion) {
    return version;
  }

  const parts = version.split(".");

  while (parts.length < 3) {
    parts.push("0");
  }

  const patch = Number.parseInt(parts[2] ?? "0", 10);
  parts[2] = Number.isNaN(patch) ? "1" : String(patch + 1);

  return parts.join(".");
}

function parseVersion(version: string): number[] | undefined {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));

  if (parts.some((part) => Number.isNaN(part))) {
    return undefined;
  }

  return parts;
}

function compareVersionParts(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;

    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function shouldAutoZip(
  existingComponent: CodeComponentRecord | undefined,
  sourceFileType: "dll" | "zip",
  autoZip: boolean | undefined,
): boolean {
  if (sourceFileType === "zip") {
    return false;
  }

  if (autoZip !== undefined) {
    return autoZip;
  }

  return extname(existingComponent?.componentOriginalFilename ?? "").toLowerCase() === ".zip";
}

function collectFileTypeWarnings(
  existingComponent: CodeComponentRecord | undefined,
  sourceFileType: "dll" | "zip",
  autoZip: boolean | undefined,
): string[] {
  if (!existingComponent?.componentOriginalFilename) {
    return [];
  }

  const existingFileType = extname(existingComponent.componentOriginalFilename).toLowerCase();

  if (!existingFileType || existingFileType === `.${sourceFileType}`) {
    return [];
  }

  if (existingFileType === ".zip" && sourceFileType === "dll" && autoZip !== false) {
    return [];
  }

  return [
    `Existing component ${existingComponent.name} was last uploaded as ${existingComponent.componentOriginalFilename}.`,
  ];
}

async function createUploadArchive(sourceFilePath: string): Promise<{
  filePath: string;
  tempDirectoryPath: string;
}> {
  const sourceDirectoryPath = dirname(sourceFilePath);
  const tempDirectoryPath = await mkdtemp(join(tmpdir(), ZIP_TEMP_DIR_PREFIX));
  const filePath = join(
    tempDirectoryPath,
    `${basename(sourceFilePath, extname(sourceFilePath))}.zip`,
  );
  const zipFile = new ZipFile();
  const output = createWriteStream(filePath);

  zipFile.outputStream.pipe(output);

  await addDirectoryToZip(zipFile, sourceDirectoryPath, sourceDirectoryPath);

  const archiveComplete = new Promise<void>((resolveArchive, rejectArchive) => {
    output.on("close", () => resolveArchive());
    output.on("error", rejectArchive);
    zipFile.outputStream.on("error", rejectArchive);
  });

  zipFile.end();
  await archiveComplete;

  return { filePath, tempDirectoryPath };
}

async function addDirectoryToZip(
  zipFile: ZipFile,
  rootDirectoryPath: string,
  currentDirectoryPath: string,
): Promise<void> {
  const entries = await readdir(currentDirectoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(currentDirectoryPath, entry.name);

    if (entry.isDirectory()) {
      await addDirectoryToZip(zipFile, rootDirectoryPath, absolutePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = relative(rootDirectoryPath, absolutePath).split(sep).join("/");
    zipFile.addFile(absolutePath, relativePath);
  }
}

function parseCodeComponentRecord(value: unknown): CodeComponentRecord | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return undefined;
  }

  return {
    componentOriginalFilename:
      typeof value.componentOriginalFilename === "string" ? value.componentOriginalFilename : null,
    id: value.id,
    name: value.name,
    sasUri: typeof value.sasUri === "string" ? value.sasUri : null,
    type: typeof value.type === "string" ? value.type : null,
    version: readVersionValue(value) ?? null,
  };
}

function replaceComponentVersion(
  value: unknown,
  matchTerms: string[],
  oldVersion: string,
  newVersion: string,
  options: { newSasUri?: string },
): boolean {
  if (!isRecord(value) && !Array.isArray(value)) {
    return false;
  }

  if (Array.isArray(value)) {
    let changed = false;

    for (const item of value) {
      if (replaceComponentVersion(item, matchTerms, oldVersion, newVersion, options)) {
        changed = true;
      }
    }

    return changed;
  }

  const record = value;
  const referencesComponent = Object.values(record).some(
    (entry) => typeof entry === "string" && matchTerms.some((term) => entry.includes(term)),
  );
  let changed = false;

  if (referencesComponent) {
    for (const [key, entry] of Object.entries(record)) {
      if (typeof entry !== "string") {
        continue;
      }

      const lowerKey = key.toLowerCase();

      if (lowerKey.includes("version") && entry === oldVersion) {
        record[key] = newVersion;
        changed = true;
        continue;
      }

      if (options.newSasUri && lowerKey.includes("sasuri") && entry.includes(oldVersion)) {
        record[key] = options.newSasUri;
        changed = true;
      }
    }
  }

  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string" && looksLikeJson(entry)) {
      try {
        const parsed = JSON.parse(entry) as unknown;

        if (replaceComponentVersion(parsed, matchTerms, oldVersion, newVersion, options)) {
          record[key] = JSON.stringify(parsed);
          changed = true;
        }
      } catch {
        // Ignore non-JSON strings that happen to start with JSON-like characters.
      }
      continue;
    }

    if (replaceComponentVersion(entry, matchTerms, oldVersion, newVersion, options)) {
      changed = true;
    }
  }

  return changed;
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
