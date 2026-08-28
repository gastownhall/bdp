import { parse } from "@babel/parser";

const testOnlyInternalSubpath = /^@bdp\/[^/]+\/testing(?:\/|$)/;
const relativeTestSupportPath = /(?:^|\/)test-support(?:\/|$)/;
const nodeModuleSpecifiers = new Set(["node:module", "module"]);

export function moduleSpecifiers(contents, fileName = "source.ts") {
  const program = parseProgram(contents, fileName);
  const createRequireFactories = new Set(["createRequire"]);
  const moduleNamespaces = new Set();
  const requireFunctions = new Set(["require"]);

  walk(program, (node) => {
    if (node.type !== "ImportDeclaration" || !nodeModuleSpecifiers.has(node.source.value)) return;
    for (const specifier of node.specifiers) {
      if (
        specifier.type === "ImportNamespaceSpecifier" ||
        specifier.type === "ImportDefaultSpecifier"
      )
        moduleNamespaces.add(specifier.local.name);
      else if (
        specifier.type === "ImportSpecifier" &&
        importedName(specifier.imported) === "createRequire"
      )
        createRequireFactories.add(specifier.local.name);
    }
    return;
  });
  walk(program, (node) => {
    if (
      node.type === "TSImportEqualsDeclaration" &&
      node.id.type === "Identifier" &&
      node.moduleReference.type === "TSExternalModuleReference" &&
      node.moduleReference.expression.type === "StringLiteral" &&
      nodeModuleSpecifiers.has(node.moduleReference.expression.value)
    )
      moduleNamespaces.add(node.id.name);
  });

  collectRequireFunctions(program, requireFunctions, createRequireFactories, moduleNamespaces);

  const specifiers = new Set();
  walk(program, (node) => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      addLiteral(specifiers, node.source);
    } else if (node.type === "ImportExpression") {
      addLiteral(specifiers, node.source);
    } else if (node.type === "TSImportType") {
      addLiteral(specifiers, node.source ?? node.argument);
    } else if (node.type === "TSExternalModuleReference") {
      addLiteral(specifiers, node.expression);
    } else if (node.type === "CallExpression") {
      const identifierRequire =
        node.callee.type === "Identifier" && requireFunctions.has(node.callee.name);
      const requireResolve =
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        requireFunctions.has(node.callee.object.name) &&
        memberName(node.callee) === "resolve";
      const immediateCreateRequire =
        node.callee.type === "CallExpression" &&
        isCreateRequireFactoryCall(node.callee, createRequireFactories, moduleNamespaces);
      if (identifierRequire || requireResolve || immediateCreateRequire)
        addLiteral(specifiers, node.arguments[0]);
    }
  });
  return [...specifiers];
}

export function isTestOnlyInternalSpecifier(specifier) {
  return testOnlyInternalSubpath.test(specifier) || relativeTestSupportPath.test(specifier);
}

export function testOnlyImportViolations(contents, fileName) {
  if (isTestSource(fileName)) return [];
  return moduleSpecifiers(contents, fileName).filter(isTestOnlyInternalSpecifier);
}

function isTestSource(fileName) {
  const normalized = fileName.replaceAll("\\", "/");
  return (
    /(?:^|\/)[^/]+\.(?:test|spec)\.(?:c|m)?tsx?$/.test(normalized) ||
    /^(?:apps|packages)\/[^/]+\/test-support\//.test(normalized)
  );
}

function parseProgram(contents, fileName) {
  const typescriptPlugin = fileName.endsWith(".tsx")
    ? [["typescript", { isTSX: true }], "jsx"]
    : ["typescript"];
  try {
    return parse(contents, {
      sourceType: "unambiguous",
      sourceFilename: fileName,
      plugins: [...typescriptPlugin, "decorators", "decoratorAutoAccessors"],
    }).program;
  } catch (cause) {
    throw new Error(`${fileName}: could not be parsed for dependency-boundary analysis`, { cause });
  }
}

function collectRequireFunctions(program, requireFunctions, factoryNames, namespaceNames) {
  let changed = true;
  while (changed) {
    changed = false;
    walk(program, (node) => {
      let target;
      let value;
      if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
        target = node.id.name;
        value = node.init;
      } else if (
        node.type === "AssignmentExpression" &&
        node.operator === "=" &&
        node.left.type === "Identifier"
      ) {
        target = node.left.name;
        value = node.right;
      }
      if (
        target !== undefined &&
        !requireFunctions.has(target) &&
        ((value?.type === "Identifier" && requireFunctions.has(value.name)) ||
          (value?.type === "CallExpression" &&
            isCreateRequireFactoryCall(value, factoryNames, namespaceNames)))
      ) {
        requireFunctions.add(target);
        changed = true;
      }
    });
  }
}

function importedName(imported) {
  return imported.type === "Identifier" || imported.type === "StringLiteral"
    ? (imported.name ?? imported.value)
    : undefined;
}

function isCreateRequireFactoryCall(call, factoryNames, namespaceNames) {
  if (call.callee.type === "Identifier") return factoryNames.has(call.callee.name);
  if (call.callee.type !== "MemberExpression" || call.callee.object.type !== "Identifier")
    return false;
  return namespaceNames.has(call.callee.object.name) && memberName(call.callee) === "createRequire";
}

function memberName(member) {
  const property = member.property;
  if (property.type === "Identifier" && !member.computed) return property.name;
  if (property.type === "StringLiteral") return property.value;
  return undefined;
}

function addLiteral(specifiers, node) {
  if (node?.type === "StringLiteral") specifiers.add(node.value);
  else if (
    node?.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    const value = node.quasis[0]?.value.cooked;
    if (value !== undefined) specifiers.add(value);
  }
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (typeof value.type === "string") visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "loc" && key !== "extra") walk(child, visit);
  }
}
