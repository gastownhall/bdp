package queryspike

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/theory/jsonpath"
	"github.com/theory/jsonpath/registry"
	"github.com/theory/jsonpath/spec"
)

func input(t *testing.T, text string) any {
	t.Helper()
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestStandardPredicatesAndBindings(t *testing.T) {
	cases := []struct{ name, data, selector, want string }{
		{"missing-is-not-null", `[{"id":"absent"},{"id":"null","review":null}]`, `$[?@.review == null].id`, `["null"]`},
		{"presence-includes-null-and-false", `[{"id":"absent"},{"id":"null","review":null},{"id":"false","review":false}]`, `$[?@.review].id`, `["null","false"]`},
		{"absence", `[{"id":"absent"},{"id":"null","review":null}]`, `$[?!@.review].id`, `["absent"]`},
		{"absence-or-null-explicit", `[{"id":"absent"},{"id":"null","review":null},{"id":"value","review":"ok"}]`, `$[?!@.review || @.review == null].id`, `["absent","null"]`},
		{"incomparable-order-is-false", `[{"id":"s","priority":"3"},{"id":"n","priority":3},{"id":"missing"}]`, `$[?@.priority > 2].id`, `["n"]`},
		{"literal-dotted-key", `[{"metadata":{"team.name":"ui","team":{"name":"platform"}}}]`, `$[?@.metadata["team.name"] == "ui" && @.metadata.team.name == "platform"]`, `[{"metadata":{"team.name":"ui","team":{"name":"platform"}}}]`},
		{"same-link-neighbor-witness", `[{"r":{"type":"Requires"},"p":{"type":"Requirement"}},{"r":{"type":"References"},"p":{"type":"Policy"}}]`, `$[?@.r.type == "Requires" && @.p.type == "Policy"]`, `[]`},
		{"parallel-link-bindings-preserved", `[{"r":{"id":"ab","type":"Requires"},"p":{"id":"B"}},{"r":{"id":"ab2","type":"Requires"},"p":{"id":"B"}}]`, `$[?@.r.type == "Requires"].r.id`, `["ab","ab2"]`},
		{"explicit-outer-binding-capture", `[{"p":{"properties":{"team":"platform"}},"q":{"properties":{"team":"platform"}}},{"p":{"properties":{"team":"platform"}},"q":{"properties":{"team":"ui"}}}]`, `$[?@.p.properties.team == @.q.properties.team].q.properties.team`, `["platform"]`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			path, err := jsonpath.Parse(c.selector)
			if err != nil {
				t.Fatal(err)
			}
			got := []any(path.Select(input(t, c.data)))
			want := input(t, c.want)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got %#v want %#v", got, want)
			}
		})
	}
}

func TestTrueFunctionExtension(t *testing.T) {
	reg := registry.New()
	err := reg.Register("contains_literal", spec.FuncLogical,
		func(args []spec.FuncExprArg) error {
			if len(args) != 2 {
				return fmt.Errorf("two arguments required")
			}
			for _, arg := range args {
				if !arg.ConvertsTo(spec.FuncValue) {
					return fmt.Errorf("value argument required")
				}
			}
			return nil
		},
		func(args []spec.PathValue) spec.PathValue {
			if args[0] == nil || args[1] == nil {
				return spec.Logical(false)
			}
			text, tok := spec.ValueFrom(args[0]).Value().(string)
			needle, nok := spec.ValueFrom(args[1]).Value().(string)
			return spec.Logical(tok && nok && strings.Contains(text, needle))
		})
	if err != nil {
		t.Fatal(err)
	}
	parser := jsonpath.NewParser(jsonpath.WithRegistry(reg))
	path, err := parser.Parse(`$[?contains_literal(@.title, "100%_safe*")].id`)
	if err != nil {
		t.Fatal(err)
	}
	got := []any(path.Select(input(t, `[{"id":"yes","title":"Export 100%_safe*"},{"id":"no","title":"Export 100X_safeZ"},{"id":"missing"},{"id":"wrong","title":3}]`)))
	if !reflect.DeepEqual(got, []any{"yes"}) {
		t.Fatalf("got %#v", got)
	}
}

func TestNonstandardSurfacesRejectedByStandardParser(t *testing.T) {
	for _, q := range []string{`walk_out(1, 8, true)`, `$[?@.id == "A"] | walk_out(1, 8, true)`, `$[?outgoing_any(@, @.link.type == "Requires")]`} {
		if _, err := jsonpath.Parse(q); err == nil {
			t.Errorf("unexpected acceptance of %q", q)
		}
	}
}

func graphParser(t *testing.T) *jsonpath.Parser {
	t.Helper()
	reg := registry.New()
	compiled := map[string]*jsonpath.Path{}
	err := reg.Register("bdp_outgoing_any", spec.FuncLogical,
		func(args []spec.FuncExprArg) error {
			if len(args) != 4 {
				return fmt.Errorf("four arguments required")
			}
			for _, arg := range args {
				if !arg.ConvertsTo(spec.FuncValue) {
					return fmt.Errorf("value arguments required")
				}
			}
			literal, ok := args[2].(*spec.LiteralArg)
			if !ok {
				return fmt.Errorf("nested selector must be a literal")
			}
			text, ok := literal.Value().(string)
			if !ok {
				return fmt.Errorf("nested selector must be a string")
			}
			path, err := jsonpath.Parse(text)
			if err != nil {
				return fmt.Errorf("invalid nested selector: %w", err)
			}
			segments := path.Query().Segments()
			if len(segments) != 2 || segments[0].IsDescendant() || segments[1].IsDescendant() || len(segments[0].Selectors()) != 1 || len(segments[1].Selectors()) != 1 {
				return fmt.Errorf("nested selector must select binding records only")
			}
			name, ok := segments[0].Selectors()[0].(spec.Name)
			if !ok || string(name) != "bindings" {
				return fmt.Errorf("nested selector root must be bindings")
			}
			switch segments[1].Selectors()[0].(type) {
			case *spec.FilterSelector, spec.WildcardSelector:
			default:
				return fmt.Errorf("nested selector must filter or enumerate binding records")
			}
			compiled[text] = path
			return nil
		},
		func(args []spec.PathValue) spec.PathValue {
			for _, arg := range args {
				if arg == nil {
					return spec.Logical(false)
				}
			}
			graph, ok := spec.ValueFrom(args[0]).Value().(map[string]any)
			if !ok {
				return spec.Logical(false)
			}
			source, ok := spec.ValueFrom(args[1]).Value().(map[string]any)
			if !ok {
				return spec.Logical(false)
			}
			key, ok := source["key"].(string)
			if !ok {
				return spec.Logical(false)
			}
			text, ok := spec.ValueFrom(args[2]).Value().(string)
			if !ok {
				return spec.Logical(false)
			}
			bindings, ok := graph[key].([]any)
			if !ok {
				bindings = []any{}
			}
			nested := map[string]any{"graph": graph, "captures": spec.ValueFrom(args[3]).Value(), "bindings": bindings}
			return spec.Logical(len(compiled[text].Select(nested)) > 0)
		})
	if err != nil {
		t.Fatal(err)
	}
	return jsonpath.NewParser(jsonpath.WithRegistry(reg))
}

func TestTrueGraphPredicateWithExplicitSelectorString(t *testing.T) {
	parser := graphParser(t)
	path, err := parser.Parse(`$.candidates[?bdp_outgoing_any($.graph, @, '$.bindings[?@.link.resource.type == "Requires" && @.neighbor.resource.properties.team == $.captures.resource.properties.team]', @)].key`)
	if err != nil {
		t.Fatal(err)
	}
	data := input(t, `{"candidates":[{"key":"A@a1","resource":{"properties":{"team":"platform"}}},{"key":"B@b1","resource":{"properties":{"team":"platform"}}}],"graph":{"A@a1":[{"link":{"key":"ab@l1","resource":{"type":"Requires"}},"neighbor":{"key":"B@b1","resource":{"properties":{"team":"platform"}}}},{"link":{"key":"ab2@l1","resource":{"type":"Requires"}},"neighbor":{"key":"B@b1","resource":{"properties":{"team":"platform"}}}},{"link":{"key":"ac@l1","resource":{"type":"References"}},"neighbor":{"key":"C@c1","resource":{"properties":{"team":"ui"}}}}],"B@b1":[]}}`)
	got := []any(path.Select(data))
	if !reflect.DeepEqual(got, []any{"A@a1"}) {
		t.Fatalf("got %#v", got)
	}
}

func TestNestedSelectorValidatedBeforeBooleanShortCircuit(t *testing.T) {
	parser := graphParser(t)
	if _, err := parser.Parse(`$.candidates[?1 == 2 && bdp_outgoing_any($.graph, @, 'not a JSONPath', @)]`); err == nil {
		t.Fatal("invalid literal selector accepted in unreachable branch")
	}
	if _, err := parser.Parse(`$.candidates[?bdp_outgoing_any($.graph, @, @.dynamic_selector, @)]`); err == nil {
		t.Fatal("nonliteral nested selector accepted")
	}
}

func TestGraphSelectorCannotSelectEnvelopeOrProjection(t *testing.T) {
	parser := graphParser(t)
	for _, body := range []string{"$", "$.captures", "$.bindings[*].neighbor", "$..bindings[*]"} {
		query := fmt.Sprintf("$.candidates[?bdp_outgoing_any($.graph, @, %q, @)]", body)
		if _, err := parser.Parse(query); err == nil {
			t.Errorf("accepted graph predicate selector %q", body)
		}
	}
}
