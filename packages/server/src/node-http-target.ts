const RAW_AUTHORITY_REG_NAME = /^(?:[A-Za-z0-9._~!$&'()*+,;=-]|%[0-9A-Fa-f]{2})+$/;
const RAW_AUTHORITY_IP_LITERAL = /^(?:[A-Za-z0-9._~!$&'()*+,;=:-]|%[0-9A-Fa-f]{2})+$/;

export function normalizationSafeRawRequestPath(target: string): string | undefined {
  if (target.includes("#")) return undefined;
  const queryIndex = target.indexOf("?");
  const withoutQuery = queryIndex === -1 ? target : target.slice(0, queryIndex);
  const search = queryIndex === -1 ? "" : target.slice(queryIndex);
  const schemeAuthority = /^https?:\/\//i.exec(withoutQuery);
  if (!withoutQuery.startsWith("/") && schemeAuthority === null) return undefined;
  const authorityStart =
    schemeAuthority !== null
      ? schemeAuthority[0].length
      : withoutQuery.startsWith("//")
        ? 2
        : undefined;
  const pathStart =
    authorityStart === undefined ? 0 : Math.max(withoutQuery.indexOf("/", authorityStart), 0);
  if (authorityStart !== undefined) {
    const authorityEnd = pathStart === 0 ? withoutQuery.length : pathStart;
    const authority = withoutQuery.slice(authorityStart, authorityEnd);
    if (!isNormalizationSafeRawAuthority(authority)) return undefined;
  }
  const pathname =
    pathStart === 0 && authorityStart !== undefined ? "/" : withoutQuery.slice(pathStart);
  if (target.includes("\\") || /%5c/i.test(pathname)) return undefined;
  if (!pathname.split("/").every((segment) => ![".", ".."].includes(segment.replace(/%2e/gi, "."))))
    return undefined;
  try {
    const parsed = new URL(target, "http://request.invalid");
    const pathAndQuery = `${pathname}${search}`;
    return `${parsed.pathname}${parsed.search}` === pathAndQuery ? pathAndQuery : undefined;
  } catch {
    return undefined;
  }
}

function isNormalizationSafeRawAuthority(authority: string): boolean {
  if (authority.length === 0 || authority.includes("@")) return false;
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket === -1) return false;
    const literal = authority.slice(1, closingBracket);
    const port = authority.slice(closingBracket + 1);
    return RAW_AUTHORITY_IP_LITERAL.test(literal) && (port === "" || /^:[0-9]+$/.test(port));
  }
  const portSeparator = authority.lastIndexOf(":");
  const host = portSeparator === -1 ? authority : authority.slice(0, portSeparator);
  const port = portSeparator === -1 ? undefined : authority.slice(portSeparator + 1);
  return RAW_AUTHORITY_REG_NAME.test(host) && (port === undefined || /^[0-9]+$/.test(port));
}
