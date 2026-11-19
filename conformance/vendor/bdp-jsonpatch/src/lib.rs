//! The single shared RFC 6902 (JSON Patch) applier for the cleanroom, over `serde_json::Value`,
//! with the RFC 6901 (JSON Pointer) resolution it needs. Supports `add`, `remove`, `replace`,
//! `move`, `copy`, and `test`. `patch` at the BDP layer is a delta over
//! `{ "properties": .., "metadata": .. }`.
//!
//! Lifted verbatim from `bdp-fs/src/jsonptr.rs` (Fiona) so that fs/pg/terminus share ONE applier
//! with identical semantics — divergent per-backend patch behavior is precisely what Connie's
//! conformance suite flags. Keep this the only copy; backends depend on it rather than reimplement.
//! Change semantics here deliberately, since every backend inherits the change at once.

use serde_json::Value;

/// Apply a JSON Patch document (a JSON array of ops) to `doc` in place. All-or-nothing is the
/// caller's job (we mutate a scratch clone); a bad op returns `Err` with a human reason.
pub fn apply_patch(doc: &mut Value, patch: &Value) -> Result<(), String> {
    let ops = patch.as_array().ok_or_else(|| "patch must be a JSON array".to_string())?;
    for (i, op) in ops.iter().enumerate() {
        apply_one(doc, op).map_err(|e| format!("patch op {i}: {e}"))?;
    }
    Ok(())
}

fn apply_one(doc: &mut Value, op: &Value) -> Result<(), String> {
    let kind = op.get("op").and_then(Value::as_str).ok_or("missing \"op\"")?;
    let path = op.get("path").and_then(Value::as_str).ok_or("missing \"path\"")?;
    match kind {
        "add" => {
            let value = op.get("value").cloned().ok_or("\"add\" missing \"value\"")?;
            add(doc, &parse_pointer(path)?, value)
        }
        "remove" => remove(doc, &parse_pointer(path)?).map(|_| ()),
        "replace" => {
            let value = op.get("value").cloned().ok_or("\"replace\" missing \"value\"")?;
            // Replace requires the target to exist.
            get(doc, &parse_pointer(path)?).ok_or("\"replace\" target does not exist")?;
            remove(doc, &parse_pointer(path)?)?;
            add(doc, &parse_pointer(path)?, value)
        }
        "test" => {
            let want = op.get("value").ok_or("\"test\" missing \"value\"")?;
            let got = get(doc, &parse_pointer(path)?).ok_or("\"test\" target does not exist")?;
            if got == want {
                Ok(())
            } else {
                Err("\"test\" failed".to_string())
            }
        }
        "move" => {
            let from = op.get("from").and_then(Value::as_str).ok_or("\"move\" missing \"from\"")?;
            let val = remove(doc, &parse_pointer(from)?)?;
            add(doc, &parse_pointer(path)?, val)
        }
        "copy" => {
            let from = op.get("from").and_then(Value::as_str).ok_or("\"copy\" missing \"from\"")?;
            let val = get(doc, &parse_pointer(from)?).ok_or("\"copy\" source does not exist")?.clone();
            add(doc, &parse_pointer(path)?, val)
        }
        other => Err(format!("unsupported op \"{other}\"")),
    }
}

/// Parse an RFC 6901 pointer into unescaped tokens. `""` => the whole document (empty token list).
fn parse_pointer(p: &str) -> Result<Vec<String>, String> {
    if p.is_empty() {
        return Ok(vec![]);
    }
    if !p.starts_with('/') {
        return Err(format!("pointer \"{p}\" must start with '/'"));
    }
    Ok(p[1..]
        .split('/')
        .map(|t| t.replace("~1", "/").replace("~0", "~"))
        .collect())
}

/// Resolve a pointer to a shared reference.
fn get<'a>(doc: &'a Value, tokens: &[String]) -> Option<&'a Value> {
    let mut cur = doc;
    for t in tokens {
        cur = match cur {
            Value::Object(m) => m.get(t)?,
            Value::Array(a) => a.get(t.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(cur)
}

/// Resolve the parent of the final token, mutably.
fn parent_mut<'a>(doc: &'a mut Value, tokens: &[String]) -> Option<&'a mut Value> {
    let mut cur = doc;
    for t in &tokens[..tokens.len() - 1] {
        cur = match cur {
            Value::Object(m) => m.get_mut(t)?,
            Value::Array(a) => a.get_mut(t.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(cur)
}

/// RFC 6902 `add`: into an object this is insert/replace-by-key; into an array it inserts at the
/// index (or appends for `-`). The whole-document target replaces the root.
fn add(doc: &mut Value, tokens: &[String], value: Value) -> Result<(), String> {
    if tokens.is_empty() {
        *doc = value;
        return Ok(());
    }
    let last = &tokens[tokens.len() - 1];
    let parent = parent_mut(doc, tokens).ok_or("add: parent path does not exist")?;
    match parent {
        Value::Object(m) => {
            m.insert(last.clone(), value);
            Ok(())
        }
        Value::Array(a) => {
            if last == "-" {
                a.push(value);
                Ok(())
            } else {
                let idx = last.parse::<usize>().map_err(|_| "add: bad array index")?;
                if idx > a.len() {
                    return Err("add: array index out of bounds".to_string());
                }
                a.insert(idx, value);
                Ok(())
            }
        }
        _ => Err("add: parent is not an object or array".to_string()),
    }
}

/// RFC 6902 `remove`: returns the removed value (used by `move`).
fn remove(doc: &mut Value, tokens: &[String]) -> Result<Value, String> {
    if tokens.is_empty() {
        let old = std::mem::replace(doc, Value::Null);
        return Ok(old);
    }
    let last = &tokens[tokens.len() - 1];
    let parent = parent_mut(doc, tokens).ok_or("remove: parent path does not exist")?;
    match parent {
        Value::Object(m) => m.remove(last).ok_or_else(|| "remove: key not found".to_string()),
        Value::Array(a) => {
            let idx = last.parse::<usize>().map_err(|_| "remove: bad array index")?;
            if idx >= a.len() {
                return Err("remove: array index out of bounds".to_string());
            }
            Ok(a.remove(idx))
        }
        _ => Err("remove: parent is not an object or array".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn add_replace_remove() {
        let mut doc = json!({"properties": {"status": "open"}, "metadata": {}});
        apply_patch(&mut doc, &json!([{"op":"replace","path":"/properties/status","value":"closed"}])).unwrap();
        apply_patch(&mut doc, &json!([{"op":"add","path":"/properties/assignee","value":"ada"}])).unwrap();
        apply_patch(&mut doc, &json!([{"op":"add","path":"/metadata/tags","value":["x"]}])).unwrap();
        apply_patch(&mut doc, &json!([{"op":"add","path":"/metadata/tags/-","value":"y"}])).unwrap();
        apply_patch(&mut doc, &json!([{"op":"remove","path":"/properties/status"}])).unwrap();
        assert_eq!(doc, json!({
            "properties": {"assignee": "ada"},
            "metadata": {"tags": ["x", "y"]}
        }));
    }

    #[test]
    fn test_op_and_failures() {
        let mut doc = json!({"properties": {"n": 1}, "metadata": {}});
        assert!(apply_patch(&mut doc.clone(), &json!([{"op":"test","path":"/properties/n","value":1}])).is_ok());
        assert!(apply_patch(&mut doc, &json!([{"op":"test","path":"/properties/n","value":2}])).is_err());
        // replace on a missing target fails
        assert!(apply_patch(&mut json!({"properties":{},"metadata":{}}),
            &json!([{"op":"replace","path":"/properties/x","value":1}])).is_err());
    }
}
