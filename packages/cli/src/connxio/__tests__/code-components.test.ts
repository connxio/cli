import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { updateComponentInIntegration, uploadCodeComponent } from "../code-components.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.map((directoryPath) => rm(directoryPath, { force: true, recursive: true })),
  );
  tempDirectories.length = 0;
});

describe("uploadCodeComponent", () => {
  it("uploads a zip file as-is", async () => {
    const tempDirectoryPath = await createTempDirectory();
    const filePath = join(tempDirectoryPath, "component.zip");
    await writeFile(filePath, "zip-body");

    const get = vi.fn(async () => []);
    const put = vi.fn(
      async (_path: string, options: { body: Record<string, unknown> }) => options.body,
    );

    const result = await uploadCodeComponent(
      { get, put },
      {
        filePath,
        name: "Component Upload",
      },
    );

    expect(result.autoZipped).toBe(false);
    expect(result.resolvedVersion).toBe("1.0.0");
    expect(result.uploadedFilename).toBe("component.zip");
    expect(result.uploadedFileType).toBe("zip");
    expect(put).toHaveBeenCalledWith(
      "/v2/codecomponents",
      expect.objectContaining({
        body: expect.objectContaining({
          componentOriginalFilename: "component.zip",
          mappingDll: Buffer.from("zip-body").toString("base64"),
          name: "Component Upload",
          type: "Map",
          version: "1.0.0",
        }),
      }),
    );
  });

  it("auto-zips a dll when the existing component was previously uploaded as a zip", async () => {
    const tempDirectoryPath = await createTempDirectory();
    const filePath = join(tempDirectoryPath, "component.dll");
    await writeFile(filePath, "dll-body");
    await writeFile(join(tempDirectoryPath, "readme.txt"), "extra-file");

    const get = vi.fn(async (path: string) => {
      if (path === "/v2/codecomponents") {
        return [
          {
            componentOriginalFilename: "component.zip",
            id: "component-id",
            name: "Component Upload",
            type: "Splitter",
            version: "2.3.4",
          },
        ];
      }

      if (path === "/v2/codecomponents/component-id/versions") {
        return [{ version: "2.3.4" }];
      }

      throw new Error(`Unexpected GET path: ${path}`);
    });
    const put = vi.fn(
      async (_path: string, options: { body: Record<string, unknown> }) => options.body,
    );

    const result = await uploadCodeComponent(
      { get, put },
      {
        filePath,
        name: "Component Upload",
      },
    );

    expect(result.autoZipped).toBe(true);
    expect(result.previousVersion).toBe("2.3.4");
    expect(result.resolvedVersion).toBe("2.3.5");
    expect(result.uploadedFilename).toBe("component.zip");
    expect(result.uploadedFileType).toBe("zip");
    expect(put).toHaveBeenCalledWith(
      "/v2/codecomponents",
      expect.objectContaining({
        body: expect.objectContaining({
          componentOriginalFilename: "component.zip",
          id: "component-id",
          name: "Component Upload",
          type: "Splitter",
          version: "2.3.5",
        }),
      }),
    );

    const uploadBody = put.mock.calls[0]?.[1].body as { mappingDll: string };
    expect(Buffer.from(uploadBody.mappingDll, "base64").toString("utf8")).not.toBe("dll-body");
  });

  it("rejects unsupported file types", async () => {
    const tempDirectoryPath = await createTempDirectory();
    const filePath = join(tempDirectoryPath, "component.txt");
    await writeFile(filePath, "not-supported");

    await expect(
      uploadCodeComponent(
        {
          get: vi.fn(async () => []),
          put: vi.fn(async () => null),
        },
        {
          filePath,
          name: "Component Upload",
        },
      ),
    ).rejects.toThrow("Only .dll and .zip are supported");
  });
});

describe("updateComponentInIntegration", () => {
  it("updates matching component references in nested integration data", async () => {
    const get = vi.fn(async (path: string) => {
      if (path === "/v2/integrations/integration-1") {
        return {
          config: {
            componentId: "component-id",
            componentVersion: "1.0.1",
            sasUri: "https://example.invalid/component-1.0.1.zip",
          },
          properties: JSON.stringify({
            components: [
              {
                id: "component-id",
                version: "1.0.1",
                sasUri: "https://example.invalid/component-1.0.1.zip",
              },
            ],
          }),
        };
      }

      if (path === "/v2/codecomponents") {
        return [
          {
            id: "component-id",
            name: "Component Upload",
            sasUri: "https://example.invalid/component-1.0.2.zip",
          },
        ];
      }

      throw new Error(`Unexpected GET path: ${path}`);
    });
    const put = vi.fn(
      async (_path: string, options: { body: Record<string, unknown> }) => options.body,
    );

    const result = await updateComponentInIntegration(
      { get, put },
      {
        componentName: "Component Upload",
        integrationId: "integration-1",
        newVersion: "1.0.2",
        oldVersion: "1.0.1",
      },
    );

    expect(result.updated).toBe(true);
    expect(result.componentId).toBe("component-id");
    expect(put).toHaveBeenCalledWith(
      "/v2/integrations/integration-1",
      expect.objectContaining({
        body: expect.objectContaining({
          config: expect.objectContaining({
            componentVersion: "1.0.2",
            sasUri: "https://example.invalid/component-1.0.2.zip",
          }),
        }),
      }),
    );

    const nextIntegration = put.mock.calls[0]?.[1].body as {
      properties: string;
    };
    expect(JSON.parse(nextIntegration.properties)).toEqual({
      components: [
        {
          id: "component-id",
          sasUri: "https://example.invalid/component-1.0.2.zip",
          version: "1.0.2",
        },
      ],
    });
  });

  it("returns updated false when no matching component reference is found", async () => {
    const get = vi.fn(async (path: string) => {
      if (path === "/v2/integrations/integration-2") {
        return {
          config: {
            otherComponent: "something-else",
            version: "1.0.1",
          },
        };
      }

      if (path === "/v2/codecomponents") {
        return [
          {
            id: "component-id",
            name: "Component Upload",
          },
        ];
      }

      throw new Error(`Unexpected GET path: ${path}`);
    });
    const put = vi.fn(async () => null);

    const result = await updateComponentInIntegration(
      { get, put },
      {
        componentName: "Component Upload",
        integrationId: "integration-2",
        newVersion: "1.0.2",
        oldVersion: "1.0.1",
      },
    );

    expect(result.updated).toBe(false);
    expect(result.result).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });
});

async function createTempDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), "connxio-code-components-test-"));
  tempDirectories.push(directoryPath);
  return directoryPath;
}
