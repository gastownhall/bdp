import { describe, expect, it } from "vitest";

import {
  type BdpbdStartupConfig,
  type BdpStartupConfig,
  type BdptestStartupConfig,
  ConfigError,
  type ConformanceStartupConfig,
  formatConfigError,
  formatStartupDiagnostic,
  LOCAL_TEST_SCOPE_URL,
  loadStartupConfig,
  parseConfigArgs,
  REDACTED,
  redactStartupConfig,
  type StartupConfig,
} from "./index.js";

function load(env: NodeJS.ProcessEnv, file?: { path: string; contents: string }): StartupConfig {
  return loadStartupConfig({
    env,
    ...(file === undefined ? {} : { configFile: file.path }),
    readFile: (path) => {
      if (file === undefined || path !== file.path) throw new Error(`unexpected read of ${path}`);
      return file.contents;
    },
  });
}

function loadAsBdp(env: NodeJS.ProcessEnv): BdpStartupConfig {
  return loadStartupConfig({ env, role: "bdp" });
}

function loadAsBdptest(env: NodeJS.ProcessEnv): BdptestStartupConfig {
  return loadStartupConfig({ env, role: "bdptest" });
}

function loadAsBdpbd(env: NodeJS.ProcessEnv): BdpbdStartupConfig {
  return loadStartupConfig({ env, role: "bdpbd" });
}

function loadAsConformance(env: NodeJS.ProcessEnv): ConformanceStartupConfig {
  return loadStartupConfig({ env, role: "conformance" });
}

function issues(call: () => unknown): readonly { path: string; message: string }[] {
  try {
    call();
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

const DEFAULT_SERVER_LIMITS = {
  page: { defaultItems: 50, maximumItems: 200 },
  selector: { bytes: 16_384, depth: 32, nodes: 256 },
  cursorTtlMilliseconds: 300_000,
} as const;

const MAXIMUM_SERVER_LIMITS = {
  page: { defaultItems: 1_000, maximumItems: 10_000 },
  selector: { bytes: 65_536, depth: 128, nodes: 4_096 },
  cursorTtlMilliseconds: 86_400_000,
} as const;

describe("parseConfigArgs", () => {
  it("extracts --config in both spellings and preserves every other argument", () => {
    expect(parseConfigArgs(["--config", "a.json", "--other"])).toEqual({
      configFile: "a.json",
      rest: ["--other"],
      errors: [],
    });
    expect(parseConfigArgs(["--config=b.json"]).configFile).toBe("b.json");
  });

  it("rejects a missing path", () => {
    expect(parseConfigArgs(["--config", "--help"]).errors).toEqual(["--config requires a path"]);
    expect(parseConfigArgs(["--config"]).errors).toEqual(["--config requires a path"]);
  });

  it("rejects an empty path in either spelling", () => {
    expect(parseConfigArgs(["--config="]).errors).toEqual(["--config requires a non-empty path"]);
    expect(parseConfigArgs(["--config", ""]).errors).toEqual([
      "--config requires a non-empty path",
    ]);
  });

  it("rejects a repeated flag rather than silently taking the last one", () => {
    const parsed = parseConfigArgs(["--config", "a.json", "--config=b.json"]);
    expect(parsed.errors).toEqual(["--config may be given only once"]);
  });
});

describe("defaults", () => {
  it("start in local-test mode with server.advertisedProfile deliberately unset", () => {
    expect(load({})).toEqual({
      mode: "local-test",
      scope: { url: LOCAL_TEST_SCOPE_URL },
      auth: {},
      server: { host: "127.0.0.1", port: 8080, limits: DEFAULT_SERVER_LIMITS },
      bd: { executable: "bd" },
      bdptest: {},
      conformance: { profile: "read", seed: 0, reportFormat: "json" },
    });
  });

  it("never invents an advertised profile when nothing was configured", () => {
    expect(Object.hasOwn(load({}).server, "advertisedProfile")).toBe(false);
  });
});

describe("precedence", () => {
  const file = {
    path: "/tmp/bdp.json",
    contents: JSON.stringify({
      mode: "production",
      scope: { url: "https://file.example/scope/" },
      server: { host: "0.0.0.0", port: 9000 },
      bd: { executable: "/opt/file/bd", workspace: "/srv/file" },
    }),
  };

  it("takes the config file over defaults", () => {
    const config = load({}, file);
    expect(config.scope.url).toBe("https://file.example/scope/");
    expect(config.server).toEqual({
      host: "0.0.0.0",
      port: 9000,
      limits: DEFAULT_SERVER_LIMITS,
    });
    expect(config.bd).toEqual({ executable: "/opt/file/bd", workspace: "/srv/file" });
  });

  it("takes the environment over the config file, field by field", () => {
    const config = load(
      {
        BDP_SCOPE_URL: "https://env.example/scope/",
        BDP_SERVER_PORT: "9100",
        BDP_BD_WORKSPACE: "/srv/env",
      },
      file,
    );
    expect(config.scope.url).toBe("https://env.example/scope/");
    expect(config.server).toEqual({
      host: "0.0.0.0",
      port: 9100,
      limits: DEFAULT_SERVER_LIMITS,
    });
    expect(config.bd).toEqual({ executable: "/opt/file/bd", workspace: "/srv/env" });
  });

  it("selects the config file from BDP_CONFIG when no flag is given", () => {
    const config = loadStartupConfig({
      env: { BDP_CONFIG: file.path },
      readFile: () => file.contents,
    });
    expect(config.scope.url).toBe("https://file.example/scope/");
  });

  it("takes the --config flag over BDP_CONFIG", () => {
    const config = loadStartupConfig({
      env: { BDP_CONFIG: "/never-read.json" },
      configFile: file.path,
      readFile: (path) => {
        if (path !== file.path) throw new Error(`unexpected read of ${path}`);
        return file.contents;
      },
    });
    expect(config.scope.url).toBe("https://file.example/scope/");
  });

  it("rejects an empty BDP_CONFIG instead of falling back to defaults", () => {
    const found = issues(() => loadStartupConfig({ env: { BDP_CONFIG: "" } }));
    expect(found).toEqual([
      { path: "BDP_CONFIG", message: "BDP_CONFIG must not be empty when it is set" },
    ]);
  });
});

describe("bd fields", () => {
  it("reads the executable and workspace from the environment", () => {
    expect(load({ BDP_BD_EXECUTABLE: "/opt/bd", BDP_BD_WORKSPACE: "/srv/beads" }).bd).toEqual({
      executable: "/opt/bd",
      workspace: "/srv/beads",
    });
  });

  it("omits an unset workspace rather than emitting undefined", () => {
    expect(Object.hasOwn(load({}).bd, "workspace")).toBe(false);
  });

  it("rejects an empty bd field", () => {
    const found = issues(() => load({ BDP_BD_EXECUTABLE: "", BDP_BD_WORKSPACE: "" }));
    expect(found.map((issue) => issue.path)).toEqual(["bd.executable", "bd.workspace"]);
  });
});

describe("role validation", () => {
  const productionScope = {
    BDP_MODE: "production",
    BDP_SCOPE_URL: "https://beads.example/scopes/main/",
  };

  it("requires an explicit bd workspace for bdpbd in production", () => {
    const found = issues(() => loadAsBdpbd(productionScope));
    expect(found).toEqual([
      {
        path: "bd.workspace",
        message:
          "bdpbd in production mode requires an explicit bd workspace via BDP_BD_WORKSPACE or a config file",
      },
    ]);
  });

  it("accepts bdpbd in production once the workspace is explicit", () => {
    const config = loadAsBdpbd({ ...productionScope, BDP_BD_WORKSPACE: "/srv/beads" });
    expect(config.bd.workspace).toBe("/srv/beads");
  });

  it("leaves the local-test workspace default alone for bdpbd", () => {
    expect(() => loadAsBdpbd({})).not.toThrow();
  });

  it("constrains no other role", () => {
    expect(() => loadAsBdp(productionScope)).not.toThrow();
    expect(() => loadAsBdptest(productionScope)).not.toThrow();
    expect(() => loadStartupConfig({ env: productionScope })).not.toThrow();
  });
});

describe("Scope URL normalization", () => {
  const normalized: readonly (readonly [string, string])[] = [
    ["https://EXAMPLE.com/scope/", "https://example.com/scope/"],
    ["https://example.com:443/scope/", "https://example.com/scope/"],
    ["http://example.com:80/scope/", "http://example.com/scope/"],
    ["HTTPS://Example.COM:443/Scope/", "https://example.com/Scope/"],
    ["https://example.com/scope", "https://example.com/scope/"],
    ["https://example.com", "https://example.com/"],
    ["http://127.0.0.1:9999/s/", "http://127.0.0.1:9999/s/"],
  ];

  for (const [input, expected] of normalized) {
    it(`normalizes ${input} to ${expected}`, () => {
      expect(load({ BDP_SCOPE_URL: input }).scope.url).toBe(expected);
    });
  }

  const rejected: readonly (readonly [string, string])[] = [
    ["/relative/", "must be an absolute URL"],
    ["https:\\example.com\\scope", "must be an absolute URL"],
    ["https:/example.com/scope", "must be an absolute URL"],
    ["https:example.com/scope", "must be an absolute URL"],
    ["", "must be a non-empty string"],
    ["ftp://example.com/scope/", "must use http or https"],
    ["https://user:pw@example.com/scope/", "must not embed credentials"],
    ["https://:pw@example.com/scope/", "must not embed credentials"],
    ["https://example.com/scope/?a=1", "must not carry a query string or fragment"],
    ["https://example.com/scope/#f", "must not carry a query string or fragment"],
    ["https://example.com/scope//", "must use canonical path encoding"],
    ["https://example.com/%73cope/", "must use canonical path encoding"],
    ["https://example.com/a/../victim/", "must use canonical path encoding"],
    ["https://example.com/a/%2E%2E/victim/", "must use canonical path encoding"],
    ["https://example.com/a/.%2e/victim/", "must use canonical path encoding"],
    ["https://example.com/scope\\evil/", "must use canonical path encoding"],
  ];

  for (const [url, expected] of rejected) {
    it(`rejects ${JSON.stringify(url)}`, () => {
      const messages = issues(() => load({ BDP_SCOPE_URL: url })).map((issue) => issue.message);
      expect(messages.some((message) => message.includes(expected))).toBe(true);
    });
  }

  it("never echoes the value, which is where a mistyped credential lands", () => {
    const secret = "s3cret-token";
    for (const url of [secret, `ftp://${secret}.example/s/`, `https://u:${secret}@e.example/s/`]) {
      const messages = issues(() => load({ BDP_SCOPE_URL: url })).map((issue) => issue.message);
      expect(messages.join(" ")).not.toContain(secret);
    }
  });
});

describe("derived local-test Scope URL", () => {
  it("matches the configured listener rather than a fixed constant", () => {
    expect(load({ BDP_SERVER_HOST: "192.168.1.10", BDP_SERVER_PORT: "9000" }).scope.url).toBe(
      "http://192.168.1.10:9000/local-test/",
    );
  });

  it("is normalized by the same validator as a supplied Scope URL", () => {
    // Port 80 is dropped from the href, which only happens if the derived URL went
    // through URL serialization rather than being pasted together as a string.
    expect(load({ BDP_SERVER_HOST: "EXAMPLE.test", BDP_SERVER_PORT: "80" }).scope.url).toBe(
      "http://example.test/local-test/",
    );
  });

  const undialable: readonly (readonly [string, NodeJS.ProcessEnv])[] = [
    ["IPv4 wildcard", { BDP_SERVER_HOST: "0.0.0.0" }],
    ["bare IPv6 wildcard", { BDP_SERVER_HOST: "::" }],
    ["bracketed IPv6 wildcard", { BDP_SERVER_HOST: "[::]" }],
    ["IPv6 wildcard written out", { BDP_SERVER_HOST: "0:0:0:0:0:0:0:0" }],
    ["shorthand IPv4 wildcard", { BDP_SERVER_HOST: "0" }],
    ["ephemeral port", { BDP_SERVER_PORT: "0" }],
  ];

  for (const [label, env] of undialable) {
    it(`refuses to derive a Scope URL from a ${label}`, () => {
      const found = issues(() => load(env));
      expect(found.map((issue) => issue.path)).toEqual(["scope.url"]);
      expect(found[0]?.message).toContain("must be set explicitly");
    });
  }

  it("accepts a wildcard listener once the Scope URL is explicit", () => {
    const config = load({
      BDP_SERVER_HOST: "0.0.0.0",
      BDP_SERVER_PORT: "0",
      BDP_SCOPE_URL: "http://beads.example/main/",
    });
    expect(config.server).toEqual({ host: "0.0.0.0", port: 0, limits: DEFAULT_SERVER_LIMITS });
    expect(config.scope.url).toBe("http://beads.example/main/");
  });

  it("brackets a bare IPv6 host", () => {
    expect(load({ BDP_SERVER_HOST: "::1" }).scope.url).toBe("http://[::1]:8080/local-test/");
  });

  it("does not double-bracket an already-bracketed IPv6 host", () => {
    expect(load({ BDP_SERVER_HOST: "[::1]", BDP_SERVER_PORT: "9000" }).scope.url).toBe(
      "http://[::1]:9000/local-test/",
    );
  });

  it("drops the default port, as URL serialization does", () => {
    expect(load({ BDP_SERVER_PORT: "80" }).scope.url).toBe("http://127.0.0.1/local-test/");
  });

  it("is the documented constant under the default host and port", () => {
    expect(LOCAL_TEST_SCOPE_URL).toBe("http://127.0.0.1:8080/local-test/");
  });
});

describe("server.host is a host and nothing else", () => {
  const accepted = [
    "127.0.0.1",
    "localhost",
    "beads.example",
    "::1",
    "[::1]",
    "example.test.",
    // Valid but uncompressed: a legitimate address, not a malformed one.
    "0:0:0:0:0:0:0:1",
  ];

  for (const host of accepted) {
    it(`accepts ${host}`, () => {
      expect(load({ BDP_SERVER_HOST: host }).server.host).toBe(host);
    });
  }

  const rejected: readonly (readonly [string, string])[] = [
    ["a space", "bad host"],
    ["a scheme", "http://beads.example"],
    ["userinfo", "user@beads.example"],
    ["userinfo with a password", "user:pw@beads.example"],
    ["a port", "beads.example:9000"],
    ["a bracketed IPv6 literal with a port", "[::1]:9000"],
    ["a path", "beads.example/scope"],
    ["a query string", "beads.example?a=1"],
    ["a fragment", "beads.example#f"],
    ["an unterminated IPv6 literal", "[::1"],
    ["a malformed IPv6 literal", "[gg::1]"],
    ["an empty bracket pair", "[]"],
    // The URL parser deletes these instead of refusing them, which would silently
    // turn the host into a different name.
    ["an embedded newline", "beads\nexample"],
    ["an embedded tab", "beads\texample"],
  ];

  for (const [label, host] of rejected) {
    it(`rejects ${label}`, () => {
      const found = issues(() => load({ BDP_SERVER_HOST: host }));
      expect(found.map((issue) => issue.path)).toEqual(["server.host"]);
    });
  }

  it("does not echo the rejected value, which may be a misplaced credential", () => {
    const secret = "s3cret-token@beads.example";
    const found = issues(() => load({ BDP_SERVER_HOST: secret }));
    expect(found[0]?.message).not.toContain("s3cret-token");
  });
});

describe("production identity", () => {
  it("requires an explicit Scope URL", () => {
    expect(issues(() => load({ BDP_MODE: "production" }))).toEqual([
      {
        path: "scope.url",
        message:
          "production mode requires an explicit Scope URL via BDP_SCOPE_URL or a config file",
      },
    ]);
  });

  it("rejects the reserved local-test path on any host", () => {
    for (const url of [
      LOCAL_TEST_SCOPE_URL,
      "https://beads.example/local-test/",
      "https://beads.example/local-test",
    ]) {
      const found = issues(() => load({ BDP_MODE: "production", BDP_SCOPE_URL: url }));
      expect(found[0]?.message).toContain("reserved local-test path");
    }
  });

  it("allows a loopback Scope URL that does not use the reserved path", () => {
    const config = load({ BDP_MODE: "production", BDP_SCOPE_URL: "http://127.0.0.1:9999/main/" });
    expect(config.scope.url).toBe("http://127.0.0.1:9999/main/");
  });

  it("does not treat a path that merely starts with the same letters as reserved", () => {
    const config = load({
      BDP_MODE: "production",
      BDP_SCOPE_URL: "https://beads.example/local-testing/",
    });
    expect(config.scope.url).toBe("https://beads.example/local-testing/");
  });

  it("accepts an explicit production Scope URL", () => {
    const config = load({
      BDP_MODE: "production",
      BDP_SCOPE_URL: "https://beads.example/scopes/main/",
    });
    expect(config).toMatchObject({
      mode: "production",
      scope: { url: "https://beads.example/scopes/main/" },
    });
  });

  it("does not accuse an unparseable production Scope URL of being the local-test URL", () => {
    const found = issues(() => load({ BDP_MODE: "production", BDP_SCOPE_URL: "not a url" }));
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("must be an absolute URL");
  });
});

describe("port contract", () => {
  // An explicit Scope URL isolates the port rules from the derived-Scope-URL rules,
  // which also refuse port 0.
  const dialable = { BDP_SCOPE_URL: "http://beads.example/main/" };
  const fromEnv = (port: string): StartupConfig => load({ ...dialable, BDP_SERVER_PORT: port });
  const fromFile = (contents: string): StartupConfig =>
    load(dialable, { path: "/p.json", contents });
  const fromJson = (port: unknown): StartupConfig => fromFile(JSON.stringify({ server: { port } }));

  describe("a string keeps its spelling, so the spelling is checked", () => {
    const accepted: readonly (readonly [string, number])[] = [
      ["0", 0],
      ["80", 80],
      ["8080", 8080],
      ["65535", 65535],
    ];

    for (const [input, expected] of accepted) {
      it(`accepts ${JSON.stringify(input)}`, () => {
        expect(fromEnv(input).server.port).toBe(expected);
      });
    }

    const rejected = ["", " 8080", "8080 ", "8e3", "0x10", "+80", "080", "80.0", "-1", "65536"];

    for (const input of rejected) {
      it(`rejects ${JSON.stringify(input)}`, () => {
        expect(issues(() => fromEnv(input)).map((issue) => issue.path)).toEqual(["server.port"]);
      });
    }

    it("holds a JSON string to the same spelling rule as an environment value", () => {
      expect(fromJson("8080").server.port).toBe(8080);
      expect(issues(() => fromJson("8e3")).map((issue) => issue.path)).toEqual(["server.port"]);
    });
  });

  describe("a JSON number has already lost its spelling, so only the value is checked", () => {
    it("cannot distinguish 8e3 from 8000 and accepts both as 8000", () => {
      expect(fromFile('{"server":{"port":8e3}}').server.port).toBe(8000);
      expect(fromFile('{"server":{"port":8000}}').server.port).toBe(8000);
    });

    it("accepts an in-range integer", () => {
      expect(fromJson(9000).server.port).toBe(9000);
    });

    const rejected: readonly (number | boolean | null)[] = [80.5, -1, 65536, true, null];

    for (const input of rejected) {
      it(`rejects ${JSON.stringify(input)}`, () => {
        expect(issues(() => fromJson(input)).map((issue) => issue.path)).toEqual(["server.port"]);
      });
    }
  });
});

describe("validation", () => {
  it("rejects unknown config-file keys so a typo is loud", () => {
    const found = issues(() =>
      load({}, { path: "/c.json", contents: '{"scope":{"uri":"x"},"nope":1}' }),
    );
    expect(found).toEqual([
      { path: "scope.uri", message: "unknown configuration key scope.uri" },
      { path: "nope", message: "unknown configuration key nope" },
    ]);
  });

  it("reports every issue in one throw", () => {
    const found = issues(() =>
      load({ BDP_MODE: "staging", BDP_SERVER_PORT: "70000", BDP_BD_EXECUTABLE: "" }),
    );
    expect(found.map((issue) => issue.path)).toEqual(["mode", "server.port", "bd.executable"]);
  });

  it("reports an unreadable config file rather than starting on defaults", () => {
    const found = issues(() =>
      loadStartupConfig({
        env: {},
        configFile: "/missing.json",
        readFile: () => {
          throw new Error("ENOENT");
        },
      }),
    );
    expect(found[0]?.message).toContain("could not read /missing.json");
  });

  it("reports a config file that is not a JSON object", () => {
    const found = issues(() => load({}, { path: "/c.json", contents: "[1,2]" }));
    expect(found[0]?.message).toContain("must contain a JSON object");
  });
});

describe("server.advertisedProfile", () => {
  it("is unset by default so a future server cannot claim a profile the operator never asked for", () => {
    expect(Object.hasOwn(load({}).server, "advertisedProfile")).toBe(false);
  });

  const accepted = ["read", "read-update", "transactional"] as const;
  for (const value of accepted) {
    it(`accepts the normative wire token ${value} from the environment`, () => {
      expect(load({ BDP_SERVER_ADVERTISED_PROFILE: value }).server.advertisedProfile).toBe(value);
    });
  }

  it("takes the config file value when supplied", () => {
    const config = load(
      {},
      { path: "/c.json", contents: '{"server":{"advertisedProfile":"read-update"}}' },
    );
    expect(config.server.advertisedProfile).toBe("read-update");
  });

  it("refuses the human label read+update, which is not the wire token", () => {
    const found = issues(() => load({ BDP_SERVER_ADVERTISED_PROFILE: "read+update" }));
    expect(found.map((issue) => issue.path)).toEqual(["server.advertisedProfile"]);
    expect(found[0]?.message).toContain("read-update");
  });

  it("refuses an unknown profile without echoing the value", () => {
    const secret = "s3cret-profile";
    const found = issues(() => load({ BDP_SERVER_ADVERTISED_PROFILE: secret }));
    expect(found.map((issue) => issue.path)).toEqual(["server.advertisedProfile"]);
    expect(found[0]?.message).not.toContain(secret);
  });
});

describe("server.internalFaultResource", () => {
  it("is unset by default so no shipping server carries an ambient fault", () => {
    expect(Object.hasOwn(load({}).server, "internalFaultResource")).toBe(false);
  });

  it("accepts a canonical absolute HTTPS resource URL", () => {
    const resource = "https://scope.example/acme/beads/demo-a";
    expect(
      load({ BDP_SERVER_INTERNAL_FAULT_RESOURCE: resource }).server.internalFaultResource,
    ).toBe(resource);
  });

  it("takes the config file value when supplied", () => {
    const config = load(
      {},
      {
        path: "/c.json",
        contents: '{"server":{"internalFaultResource":"http://127.0.0.1:8080/local-test/x"}}',
      },
    );
    expect(config.server.internalFaultResource).toBe("http://127.0.0.1:8080/local-test/x");
  });

  for (const [label, value] of [
    ["a relative path", "beads/demo-a"],
    ["a non-HTTP scheme", "file:///etc/hosts"],
    ["embedded credentials", "https://user:pass@scope.example/beads/demo-a"],
    ["a query string", "https://scope.example/beads/demo-a?x=1"],
    ["a fragment", "https://scope.example/beads/demo-a#f"],
    ["non-canonical spelling", "https://scope.example/beads/%2e%2e/demo-a"],
    ["an empty string", ""],
  ] as const) {
    it(`refuses ${label}`, () => {
      const found = issues(() => load({ BDP_SERVER_INTERNAL_FAULT_RESOURCE: value }));
      expect(found.map((issue) => issue.path)).toEqual(["server.internalFaultResource"]);
    });
  }

  it("is refused outright in production mode, like every test-only affordance", () => {
    const found = issues(() =>
      load({
        BDP_MODE: "production",
        BDP_SCOPE_URL: "https://beads.example/scopes/main/",
        BDP_SERVER_INTERNAL_FAULT_RESOURCE: "https://beads.example/scopes/main/beads/demo-a",
      }),
    );
    expect(found.map((issue) => issue.path)).toEqual(["server.internalFaultResource"]);
    expect(found[0]?.message).toContain("refused in production mode");
  });
});

describe("server.limits", () => {
  it("carries the public server defaults", () => {
    expect(load({}).server.limits).toEqual(DEFAULT_SERVER_LIMITS);
  });

  it("reads every limit from its public environment variable", () => {
    expect(
      load({
        BDP_SERVER_PAGE_DEFAULT_ITEMS: "12",
        BDP_SERVER_PAGE_MAXIMUM_ITEMS: "34",
        BDP_SERVER_SELECTOR_BYTES: "4096",
        BDP_SERVER_SELECTOR_DEPTH: "8",
        BDP_SERVER_SELECTOR_NODES: "64",
        BDP_SERVER_CURSOR_TTL_MILLISECONDS: "45000",
      }).server.limits,
    ).toEqual({
      page: { defaultItems: 12, maximumItems: 34 },
      selector: { bytes: 4096, depth: 8, nodes: 64 },
      cursorTtlMilliseconds: 45_000,
    });
  });

  it("accepts every exact public safety maximum from canonical environment text", () => {
    expect(
      load({
        BDP_SERVER_PAGE_DEFAULT_ITEMS: "1000",
        BDP_SERVER_PAGE_MAXIMUM_ITEMS: "10000",
        BDP_SERVER_SELECTOR_BYTES: "65536",
        BDP_SERVER_SELECTOR_DEPTH: "128",
        BDP_SERVER_SELECTOR_NODES: "4096",
        BDP_SERVER_CURSOR_TTL_MILLISECONDS: "86400000",
      }).server.limits,
    ).toEqual(MAXIMUM_SERVER_LIMITS);
  });

  it("accepts every exact public safety maximum from JSON numbers", () => {
    expect(
      load(
        {},
        {
          path: "/limits.json",
          contents: JSON.stringify({ server: { limits: MAXIMUM_SERVER_LIMITS } }),
        },
      ).server.limits,
    ).toEqual(MAXIMUM_SERVER_LIMITS);
  });

  it.each([
    ["BDP_SERVER_PAGE_DEFAULT_ITEMS", "server.limits.page.defaultItems", 1_000],
    ["BDP_SERVER_PAGE_MAXIMUM_ITEMS", "server.limits.page.maximumItems", 10_000],
    ["BDP_SERVER_SELECTOR_BYTES", "server.limits.selector.bytes", 65_536],
    ["BDP_SERVER_SELECTOR_DEPTH", "server.limits.selector.depth", 128],
    ["BDP_SERVER_SELECTOR_NODES", "server.limits.selector.nodes", 4_096],
    ["BDP_SERVER_CURSOR_TTL_MILLISECONDS", "server.limits.cursorTtlMilliseconds", 86_400_000],
  ] as const)("rejects %s one above its public safety maximum", (name, path, maximum) => {
    const secret = `${maximum + 1}`;
    const found = issues(() => load({ [name]: secret }));
    expect(found).toEqual([
      {
        path,
        message: `${path} written as text must be a canonical integer in 1..${maximum}`,
      },
    ]);
    expect(found[0]?.message).not.toContain(secret);
  });

  it.each([
    ["page.defaultItems", { page: { defaultItems: 1_001, maximumItems: 10_000 } }, 1_000],
    ["page.maximumItems", { page: { defaultItems: 50, maximumItems: 10_001 } }, 10_000],
    ["selector.bytes", { selector: { bytes: 65_537 } }, 65_536],
    ["selector.depth", { selector: { depth: 129 } }, 128],
    ["selector.nodes", { selector: { nodes: 4_097 } }, 4_096],
    ["cursorTtlMilliseconds", { cursorTtlMilliseconds: 86_400_001 }, 86_400_000],
  ] as const)("rejects JSON number one above the maximum for %s", (suffix, override, maximum) => {
    const path = `server.limits.${suffix}` as const;
    const found = issues(() =>
      load(
        {},
        {
          path: "/limits.json",
          contents: JSON.stringify({ server: { limits: override } }),
        },
      ),
    );
    expect(found).toEqual([{ path, message: `${path} must be an integer in 1..${maximum}` }]);
  });

  it.each([0, -1, 1.5, true] as const)("rejects JSON limit value %j", (value) => {
    const path = "server.limits.page.defaultItems" as const;
    const found = issues(() =>
      load(
        {},
        {
          path: "/limits.json",
          contents: JSON.stringify({ server: { limits: { page: { defaultItems: value } } } }),
        },
      ),
    );
    expect(found).toEqual([{ path, message: `${path} must be an integer in 1..1000` }]);
  });

  it.each([
    ["limits", { server: { limits: null } }, "server.limits"],
    ["page", { server: { limits: { page: [] } } }, "server.limits.page"],
    ["selector", { server: { limits: { selector: false } } }, "server.limits.selector"],
  ] as const)("rejects a non-object JSON %s branch", (_label, value, path) => {
    expect(
      issues(() => load({}, { path: "/limits.json", contents: JSON.stringify(value) })),
    ).toEqual([{ path, message: `${path} must be a JSON object` }]);
  });

  it("reads the nested JSON shape and applies environment precedence per leaf", () => {
    const config = load(
      { BDP_SERVER_SELECTOR_DEPTH: "9" },
      {
        path: "/c.json",
        contents: JSON.stringify({
          server: {
            limits: {
              page: { defaultItems: 10, maximumItems: 20 },
              selector: { bytes: 2048, depth: 7, nodes: 48 },
              cursorTtlMilliseconds: 60_000,
            },
          },
        }),
      },
    );
    expect(config.server.limits).toEqual({
      page: { defaultItems: 10, maximumItems: 20 },
      selector: { bytes: 2048, depth: 9, nodes: 48 },
      cursorTtlMilliseconds: 60_000,
    });
  });

  it.each([
    ["BDP_SERVER_PAGE_DEFAULT_ITEMS", "server.limits.page.defaultItems"],
    ["BDP_SERVER_PAGE_MAXIMUM_ITEMS", "server.limits.page.maximumItems"],
    ["BDP_SERVER_SELECTOR_BYTES", "server.limits.selector.bytes"],
    ["BDP_SERVER_SELECTOR_DEPTH", "server.limits.selector.depth"],
    ["BDP_SERVER_SELECTOR_NODES", "server.limits.selector.nodes"],
    ["BDP_SERVER_CURSOR_TTL_MILLISECONDS", "server.limits.cursorTtlMilliseconds"],
  ] as const)("requires %s to be a canonical positive safe integer", (name, path) => {
    for (const value of ["", "0", "01", "+1", "1.5", "1e3", " 1"] as const) {
      expect(issues(() => load({ [name]: value })).map((issue) => issue.path)).toContain(path);
    }
  });

  it("requires the default page size not to exceed the maximum", () => {
    expect(
      issues(() =>
        load({
          BDP_SERVER_PAGE_DEFAULT_ITEMS: "201",
          BDP_SERVER_PAGE_MAXIMUM_ITEMS: "200",
        }),
      ),
    ).toEqual([
      {
        path: "server.limits.page",
        message: "server.limits.page.defaultItems must not exceed server.limits.page.maximumItems",
      },
    ]);
  });

  it("keeps limit content role-owned while keeping nested vocabulary globally loud", () => {
    expect(() =>
      loadStartupConfig({
        env: { BDP_SCOPE_URL: "https://beads.example/scope/" },
        configFile: "/shared.json",
        readFile: () =>
          JSON.stringify({ server: { limits: { page: { defaultItems: "invalid" } } } }),
        role: "bdp",
      }),
    ).not.toThrow();
    expect(
      issues(() =>
        loadStartupConfig({
          env: { BDP_SCOPE_URL: "https://beads.example/scope/" },
          configFile: "/shared.json",
          readFile: () => JSON.stringify({ server: { limits: { page: { defaultItemz: 10 } } } }),
          role: "bdp",
        }),
      ),
    ).toEqual([
      {
        path: "server.limits.page.defaultItemz",
        message: "unknown configuration key server.limits.page.defaultItemz",
      },
    ]);
  });
});

describe("bdptest.fixture", () => {
  it("is unset by default", () => {
    expect(Object.hasOwn(load({}).bdptest, "fixture")).toBe(false);
  });

  it("reads the fixture identifier from the environment", () => {
    expect(load({ BDP_BDPTEST_FIXTURE: "minimal-read" }).bdptest.fixture).toBe("minimal-read");
  });

  it("takes the config file value when supplied", () => {
    const config = load({}, { path: "/c.json", contents: '{"bdptest":{"fixture":"corpus-a"}}' });
    expect(config.bdptest.fixture).toBe("corpus-a");
  });

  const accepted = [
    // Minimum length: one character.
    "a",
    "Z9",
    "minimal-read",
    "corpus.a",
    "corpus_a",
    "0",
    // Maximum length: 128 characters exactly.
    `${"a".repeat(128)}`,
  ];

  for (const value of accepted) {
    it(`accepts the grammar-legal identifier ${value.length > 32 ? `${value.slice(0, 8)}… (${value.length} chars)` : JSON.stringify(value)}`, () => {
      expect(load({ BDP_BDPTEST_FIXTURE: value }).bdptest.fixture).toBe(value);
    });
  }

  // NUL is injected through String.fromCharCode so the source file stays ASCII
  // and never becomes binary.
  const NUL = String.fromCharCode(0);
  const rejected: readonly (readonly [string, string])[] = [
    ["empty string", ""],
    ["length 129 (one over the maximum)", "a".repeat(129)],
    ["leading whitespace", " minimal"],
    ["trailing whitespace", "minimal "],
    ["leading hyphen", "-minimal"],
    ["leading dot", ".minimal"],
    ["leading underscore", "_minimal"],
    ["embedded space", "minimal read"],
    ["embedded tab", "minimal\tread"],
    ["embedded newline", "minimal\nread"],
    ["embedded carriage return", "minimal\rread"],
    ["path separator", "corpus/a"],
    ["parent-directory traversal", "corpus/../secret"],
    ["a NUL byte", `minimal${NUL}read`],
    ["non-ASCII letter", "minimál"],
  ];

  for (const [label, value] of rejected) {
    it(`refuses ${label}`, () => {
      const found = issues(() => load({ BDP_BDPTEST_FIXTURE: value }));
      expect(found.map((issue) => issue.path)).toEqual(["bdptest.fixture"]);
      // The rejection message documents the grammar, not the value. An empty
      // string is trivially a substring of everything, so skip that one.
      if (value.length > 0) expect(found[0]?.message).not.toContain(value);
    });
  }
});

describe("conformance fields", () => {
  it("carry the documented defaults", () => {
    const config = load({});
    expect(config.conformance).toEqual({ profile: "read", seed: 0, reportFormat: "json" });
    expect(Object.hasOwn(config.conformance, "scenarioFilter")).toBe(false);
  });

  describe("conformance.profile", () => {
    const accepted = ["read", "read-update", "transactional"] as const;
    for (const value of accepted) {
      it(`accepts the normative wire token ${value}`, () => {
        expect(load({ BDP_CONFORMANCE_PROFILE: value }).conformance.profile).toBe(value);
      });
    }

    it("refuses the human label read+update", () => {
      const found = issues(() => load({ BDP_CONFORMANCE_PROFILE: "read+update" }));
      expect(found.map((issue) => issue.path)).toEqual(["conformance.profile"]);
      expect(found[0]?.message).toContain("read-update");
    });

    it("refuses an unknown value", () => {
      const found = issues(() => load({ BDP_CONFORMANCE_PROFILE: "invalid" }));
      expect(found.map((issue) => issue.path)).toEqual(["conformance.profile"]);
    });
  });

  describe("conformance.scenarioFilter", () => {
    it("stores a non-empty pattern from the environment", () => {
      expect(
        load({ BDP_CONFORMANCE_SCENARIO_FILTER: "discovery-" }).conformance.scenarioFilter,
      ).toBe("discovery-");
    });

    it("stores a punctuation-heavy substring verbatim: no glob or regex is inferred", () => {
      // A caller who spells the filter as a glob or a regex gets exactly those
      // characters back — the runner uses substring semantics only.
      const filter = "cases-*.[a-z]+";
      expect(load({ BDP_CONFORMANCE_SCENARIO_FILTER: filter }).conformance.scenarioFilter).toBe(
        filter,
      );
    });

    it("refuses an empty value", () => {
      const found = issues(() => load({ BDP_CONFORMANCE_SCENARIO_FILTER: "" }));
      expect(found.map((issue) => issue.path)).toEqual(["conformance.scenarioFilter"]);
      expect(found[0]?.message).toContain("substring");
    });

    it("is unset by default so the runner runs every scenario in the selected profile", () => {
      expect(Object.hasOwn(load({}).conformance, "scenarioFilter")).toBe(false);
    });
  });

  describe("conformance.seed", () => {
    it("accepts a canonical decimal from the environment", () => {
      expect(load({ BDP_CONFORMANCE_SEED: "42" }).conformance.seed).toBe(42);
    });

    it("accepts 0 from the environment", () => {
      expect(load({ BDP_CONFORMANCE_SEED: "0" }).conformance.seed).toBe(0);
    });

    it("accepts MAX_SAFE_INTEGER from the environment", () => {
      expect(load({ BDP_CONFORMANCE_SEED: String(Number.MAX_SAFE_INTEGER) }).conformance.seed).toBe(
        Number.MAX_SAFE_INTEGER,
      );
    });

    it("refuses MAX_SAFE_INTEGER + 1 from the environment as an out-of-range integer", () => {
      // 2^53 is representable as a Number and parses cleanly, so this exercises
      // the range check specifically rather than the spelling rule.
      const found = issues(() =>
        load({ BDP_CONFORMANCE_SEED: String(Number.MAX_SAFE_INTEGER + 1) }),
      );
      expect(found.map((issue) => issue.path)).toEqual(["conformance.seed"]);
    });

    it("accepts a JSON integer", () => {
      const config = load({}, { path: "/c.json", contents: '{"conformance":{"seed":7}}' });
      expect(config.conformance.seed).toBe(7);
    });

    it("accepts JSON number 0", () => {
      const config = load({}, { path: "/c.json", contents: '{"conformance":{"seed":0}}' });
      expect(config.conformance.seed).toBe(0);
    });

    it("accepts JSON number MAX_SAFE_INTEGER", () => {
      const contents = JSON.stringify({ conformance: { seed: Number.MAX_SAFE_INTEGER } });
      expect(load({}, { path: "/c.json", contents }).conformance.seed).toBe(
        Number.MAX_SAFE_INTEGER,
      );
    });

    it("refuses JSON number MAX_SAFE_INTEGER + 1", () => {
      const contents = JSON.stringify({ conformance: { seed: Number.MAX_SAFE_INTEGER + 1 } });
      const found = issues(() => load({}, { path: "/c.json", contents }));
      expect(found.map((issue) => issue.path)).toEqual(["conformance.seed"]);
    });

    const rejectedStrings = ["", " 1", "1 ", "1e3", "0x1", "+1", "01", "-1", "1.5"];
    for (const value of rejectedStrings) {
      it(`refuses the string ${JSON.stringify(value)}`, () => {
        const found = issues(() => load({ BDP_CONFORMANCE_SEED: value }));
        expect(found.map((issue) => issue.path)).toEqual(["conformance.seed"]);
      });
    }

    const rejectedJson: readonly (number | boolean | null | string)[] = [-1, 1.5, true, null];
    for (const value of rejectedJson) {
      it(`refuses the JSON value ${JSON.stringify(value)}`, () => {
        const found = issues(() =>
          load({}, { path: "/c.json", contents: JSON.stringify({ conformance: { seed: value } }) }),
        );
        expect(found.map((issue) => issue.path)).toEqual(["conformance.seed"]);
      });
    }

    it("cannot distinguish 1e3 from 1000 in a JSON number and accepts both as 1000", () => {
      const config = load({}, { path: "/c.json", contents: '{"conformance":{"seed":1e3}}' });
      expect(config.conformance.seed).toBe(1000);
    });
  });

  describe("conformance.reportFormat", () => {
    it("accepts text", () => {
      expect(load({ BDP_CONFORMANCE_REPORT_FORMAT: "text" }).conformance.reportFormat).toBe("text");
    });

    it("refuses an unknown format", () => {
      const found = issues(() => load({ BDP_CONFORMANCE_REPORT_FORMAT: "yaml" }));
      expect(found.map((issue) => issue.path)).toEqual(["conformance.reportFormat"]);
    });
  });

  it("does not echo a rejected profile value which might be a mistyped credential", () => {
    const secret = "s3cret";
    const found = issues(() => load({ BDP_CONFORMANCE_PROFILE: secret }));
    expect(found[0]?.message).not.toContain(secret);
  });
});

describe("role-scoped views", () => {
  const server = {
    BDP_SERVER_ADVERTISED_PROFILE: "read-update",
    BDP_SERVER_HOST: "127.0.0.1",
    BDP_SERVER_PORT: "9000",
  };
  const bdpbdEnv = { ...server, BDP_BD_WORKSPACE: "/srv/bd" };
  const bdptestEnv = { ...server, BDP_BDPTEST_FIXTURE: "corpus-a" };
  const conformanceEnv = {
    BDP_AUTH_TOKEN: "s3cret",
    BDP_SCOPE_URL: "http://beads.example/main/",
    BDP_CONFORMANCE_PROFILE: "transactional",
  };

  it("bdp returns only mode, scope, and auth", () => {
    const config = loadAsBdp({ BDP_AUTH_TOKEN: "t" });
    expect(Object.keys(config).sort()).toEqual(["auth", "mode", "scope"]);
  });

  it("bdptest returns only mode, scope, server, and bdptest", () => {
    const config = loadAsBdptest(bdptestEnv);
    expect(Object.keys(config).sort()).toEqual(["bdptest", "mode", "scope", "server"]);
    expect(config.server.advertisedProfile).toBe("read-update");
    expect(config.bdptest.fixture).toBe("corpus-a");
  });

  it("bdpbd returns only mode, scope, server, and bd", () => {
    const config = loadAsBdpbd(bdpbdEnv);
    expect(Object.keys(config).sort()).toEqual(["bd", "mode", "scope", "server"]);
    expect(config.server.advertisedProfile).toBe("read-update");
    expect(config.bd.workspace).toBe("/srv/bd");
  });

  it("conformance returns only mode, scope, auth, and conformance", () => {
    const config = loadAsConformance(conformanceEnv);
    expect(Object.keys(config).sort()).toEqual(["auth", "conformance", "mode", "scope"]);
    expect(config.conformance.profile).toBe("transactional");
    expect(config.auth.token).toBe("s3cret");
  });

  it("bdptest and bdpbd share the same server.advertisedProfile field deliberately", () => {
    const test = loadAsBdptest(server);
    const bd = loadAsBdpbd({ ...server, BDP_BD_WORKSPACE: "/srv/bd" });
    expect(test.server.advertisedProfile).toBe(bd.server.advertisedProfile);
  });
});

describe("role isolation", () => {
  it("ignores an invalid bdptest.fixture when loading as bdp", () => {
    // The client role does not read bdptest fields, so a malformed value in an
    // unrelated section must not block bdp startup.
    expect(() =>
      loadStartupConfig({ env: { BDP_BDPTEST_FIXTURE: "bad name" }, role: "bdp" }),
    ).not.toThrow();
  });

  it("ignores an invalid conformance.seed when loading as bdpbd", () => {
    expect(() =>
      loadStartupConfig({ env: { BDP_CONFORMANCE_SEED: "not-a-number" }, role: "bdpbd" }),
    ).not.toThrow();
  });

  it("ignores an invalid server.advertisedProfile when loading as bdp", () => {
    expect(() =>
      loadStartupConfig({
        env: { BDP_SERVER_ADVERTISED_PROFILE: "not-a-profile" },
        role: "bdp",
      }),
    ).not.toThrow();
  });

  it("ignores an invalid server.internalFaultResource when loading as bdp", () => {
    expect(() =>
      loadStartupConfig({
        env: { BDP_SERVER_INTERNAL_FAULT_RESOURCE: "not-a-url" },
        role: "bdp",
      }),
    ).not.toThrow();
  });

  it("skips a known but unrelated section inside a config file without a finding", () => {
    // A shared config file may carry sections for several deployments; loading
    // as bdp should ignore bdptest without flagging it.
    const contents = JSON.stringify({ bdptest: { fixture: "bad name" } });
    expect(() =>
      loadStartupConfig({
        env: {},
        configFile: "/shared.json",
        readFile: () => contents,
        role: "bdp",
      }),
    ).not.toThrow();
  });

  it("still flags a truly unknown section under any role", () => {
    const contents = JSON.stringify({ nope: {} });
    const found = issues(() =>
      loadStartupConfig({
        env: {},
        configFile: "/shared.json",
        readFile: () => contents,
        role: "bdp",
      }),
    );
    expect(found).toEqual([{ path: "nope", message: "unknown configuration key nope" }]);
  });

  it("still validates the section a role owns", () => {
    // With role=bdptest, an invalid bdptest value must still fail.
    const found = issues(() =>
      loadStartupConfig({ env: { BDP_BDPTEST_FIXTURE: "bad name" }, role: "bdptest" }),
    );
    expect(found.map((issue) => issue.path)).toEqual(["bdptest.fixture"]);
  });

  it("does not emit unrelated role sections in the resolved config", () => {
    const config = loadAsBdp({ BDP_BDPTEST_FIXTURE: "minimal", BDP_CONFORMANCE_SEED: "9" });
    expect(Object.hasOwn(config, "bdptest")).toBe(false);
    expect(Object.hasOwn(config, "conformance")).toBe(false);
    expect(Object.hasOwn(config, "server")).toBe(false);
    expect(Object.hasOwn(config, "bd")).toBe(false);
  });

  it("flags a nested typo inside an unrelated section, because structural vocabulary is global", () => {
    // A typo like `fixtre` is a mistake in the file's shape, not a value.
    // Even under a role that does not read bdptest, it stays loud so a shared
    // config file cannot hide it under an unrelated deployment.
    const contents = JSON.stringify({ bdptest: { fixtre: "x" } });
    const found = issues(() =>
      loadStartupConfig({
        env: {},
        configFile: "/shared.json",
        readFile: () => contents,
        role: "bdp",
      }),
    );
    expect(found).toEqual([
      { path: "bdptest.fixtre", message: "unknown configuration key bdptest.fixtre" },
    ]);
  });

  it("flags a nested typo inside a role-owned section", () => {
    const contents = JSON.stringify({ bdptest: { fixtre: "x" } });
    const found = issues(() =>
      loadStartupConfig({
        env: {},
        configFile: "/shared.json",
        readFile: () => contents,
        role: "bdptest",
      }),
    );
    expect(found.map((issue) => issue.path)).toEqual(["bdptest.fixtre"]);
  });

  it("ignores a grammar-illegal value in an unrelated section under a client role", () => {
    // Same file, different role: the value fails validation under bdptest,
    // but bdp never consumes it, so bdp starts clean.
    const contents = JSON.stringify({ bdptest: { fixture: "bad name" } });
    expect(() =>
      loadStartupConfig({
        env: {},
        configFile: "/shared.json",
        readFile: () => contents,
        role: "bdp",
      }),
    ).not.toThrow();
    expect(
      issues(() =>
        loadStartupConfig({
          env: {},
          configFile: "/shared.json",
          readFile: () => contents,
          role: "bdptest",
        }),
      ).map((issue) => issue.path),
    ).toEqual(["bdptest.fixture"]);
  });
});

describe("shared local-test Scope identity across roles", () => {
  it("derives the same Scope URL from a shared listener regardless of role", () => {
    const shared = { BDP_SERVER_HOST: "192.168.1.10", BDP_SERVER_PORT: "9000" };
    const expected = "http://192.168.1.10:9000/local-test/";

    const bdp = loadAsBdp(shared);
    const bdptest = loadAsBdptest(shared);
    const bdpbd = loadAsBdpbd(shared);
    const conformance = loadAsConformance(shared);

    expect(bdp.scope.url).toBe(expected);
    expect(bdptest.scope.url).toBe(expected);
    expect(bdpbd.scope.url).toBe(expected);
    expect(conformance.scope.url).toBe(expected);

    // Only the server roles emit `server`; bdp/conformance still omit it,
    // even though they had to consult host/port for the derivation.
    expect(Object.hasOwn(bdp, "server")).toBe(false);
    expect(Object.hasOwn(conformance, "server")).toBe(false);
    expect(bdptest.server).toEqual({
      host: "192.168.1.10",
      port: 9000,
      limits: DEFAULT_SERVER_LIMITS,
    });
    expect(bdpbd.server).toEqual({
      host: "192.168.1.10",
      port: 9000,
      limits: DEFAULT_SERVER_LIMITS,
    });
  });

  it("refuses a wildcard listener under every role because the derivation would name nothing", () => {
    const env = { BDP_SERVER_HOST: "0.0.0.0" };
    expect(issues(() => loadAsBdp(env)).map((issue) => issue.path)).toEqual(["scope.url"]);
    expect(issues(() => loadAsBdptest(env)).map((issue) => issue.path)).toEqual(["scope.url"]);
    expect(issues(() => loadAsBdpbd(env)).map((issue) => issue.path)).toEqual(["scope.url"]);
    expect(issues(() => loadAsConformance(env)).map((issue) => issue.path)).toEqual(["scope.url"]);
  });

  it("isolates a client with an explicit Scope URL from invalid server-only inputs", () => {
    // BDP_SCOPE_URL is explicit, so the derivation never fires; every
    // server-only value below is truly irrelevant to bdp and must not block
    // it. Same for conformance.
    const env = {
      BDP_SCOPE_URL: "http://beads.example/main/",
      BDP_SERVER_HOST: "not a host",
      BDP_SERVER_PORT: "not a port",
      BDP_SERVER_ADVERTISED_PROFILE: "not-a-profile",
    };
    const bdp = loadAsBdp(env);
    expect(bdp.scope.url).toBe("http://beads.example/main/");
    expect(Object.hasOwn(bdp, "server")).toBe(false);

    const conformance = loadAsConformance(env);
    expect(conformance.scope.url).toBe("http://beads.example/main/");
    expect(Object.hasOwn(conformance, "server")).toBe(false);

    // But under a server role, those same inputs still fail.
    const bdptestIssues = issues(() => loadAsBdptest(env)).map((issue) => issue.path);
    expect(bdptestIssues).toEqual(
      expect.arrayContaining(["server.host", "server.port", "server.advertisedProfile"]),
    );
  });
});

describe("full shared contract (no role)", () => {
  it("collects every known field into one contract when role is omitted", () => {
    const config = loadStartupConfig({
      env: {
        BDP_SERVER_ADVERTISED_PROFILE: "read-update",
        BDP_BDPTEST_FIXTURE: "minimal",
        BDP_CONFORMANCE_PROFILE: "transactional",
        BDP_CONFORMANCE_SCENARIO_FILTER: "cases-",
        BDP_CONFORMANCE_SEED: "17",
        BDP_CONFORMANCE_REPORT_FORMAT: "text",
      },
    });
    expect(config.server.advertisedProfile).toBe("read-update");
    expect(config.bdptest.fixture).toBe("minimal");
    expect(config.conformance).toEqual({
      profile: "transactional",
      scenarioFilter: "cases-",
      seed: 17,
      reportFormat: "text",
    });
  });

  it("rejects an unknown key inside a new section rather than silently dropping it", () => {
    const found = issues(() =>
      load({}, { path: "/c.json", contents: '{"conformance":{"nope":true}}' }),
    );
    expect(found).toEqual([
      { path: "conformance.nope", message: "unknown configuration key conformance.nope" },
    ]);
  });
});

describe("redaction", () => {
  it("hides the bearer token in diagnostics while the resolved config keeps it", () => {
    const config = load({ BDP_AUTH_TOKEN: "s3cret" });
    expect(config.auth.token).toBe("s3cret");
    expect(redactStartupConfig(config).auth?.token).toBe(REDACTED);

    const diagnostic = formatStartupDiagnostic(config, "bdp");
    expect(diagnostic).not.toContain("s3cret");
    expect(JSON.parse(diagnostic)).toEqual({
      level: "info",
      event: "startup.config",
      executable: "bdp",
      config: { ...config, auth: { token: REDACTED } },
    });
  });

  it("leaves a token-free config untouched", () => {
    const config = load({});
    expect(redactStartupConfig(config)).toBe(config);
  });

  it("leaves a server-only role view unchanged because it has no auth section", () => {
    const config = loadAsBdptest({
      BDP_AUTH_TOKEN: "s3cret",
      BDP_SERVER_ADVERTISED_PROFILE: "read",
    });
    expect(redactStartupConfig(config)).toBe(config);
  });
});

describe("diagnostics", () => {
  it("serializes a config error as one JSON line", () => {
    const error = new ConfigError([{ path: "mode", message: "bad" }]);
    expect(JSON.parse(formatConfigError(error, "bdptest"))).toEqual({
      level: "error",
      event: "startup.config_error",
      executable: "bdptest",
      issues: [{ path: "mode", message: "bad" }],
    });
  });

  it("emits only the sections the role owns", () => {
    const config = loadAsBdpbd({ BDP_BD_WORKSPACE: "/srv/bd" });
    const parsed = JSON.parse(formatStartupDiagnostic(config, "bdpbd"));
    expect(Object.keys(parsed.config).sort()).toEqual(["bd", "mode", "scope", "server"]);
  });
});
