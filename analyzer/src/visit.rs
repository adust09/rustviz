//! Single-pass syn visitor that collects raw metric counts and called idents
//! for one function body. One walk feeds all four lenses.

use syn::visit::{self, Visit};

use crate::model::{ComplexityMetrics, PerformanceMetrics, SecurityMetrics};

/// Raw, un-normalized metrics for one function plus its outgoing call idents.
#[derive(Default)]
pub struct RawFn {
    pub security: SecurityMetrics,
    pub performance: PerformanceMetrics,
    pub complexity: ComplexityMetrics,
    /// Called identifiers (method name or last path segment), with repeats.
    pub calls: Vec<String>,
    /// Function's own name, for self-recursion detection.
    own_name: String,
    nesting: u32,
    loop_depth: u32,
}

impl RawFn {
    pub fn collect(own_name: &str, block: &syn::Block) -> Self {
        let mut v = RawFn {
            own_name: own_name.to_string(),
            ..Default::default()
        };
        v.visit_block(block);
        v
    }

    fn enter_nesting(&mut self) {
        self.nesting += 1;
        self.complexity.max_nesting = self.complexity.max_nesting.max(self.nesting);
    }

    fn leave_nesting(&mut self) {
        self.nesting = self.nesting.saturating_sub(1);
    }
}

/// Last path segment ident as a string (`Vec::with_capacity` -> `with_capacity`).
fn last_segment(path: &syn::Path) -> String {
    path.segments
        .last()
        .map(|s| s.ident.to_string())
        .unwrap_or_default()
}

/// Full `::`-joined path (`std::mem::transmute`).
fn full_path(path: &syn::Path) -> String {
    path.segments
        .iter()
        .map(|s| s.ident.to_string())
        .collect::<Vec<_>>()
        .join("::")
}

/// Recognize allocation-creating constructor calls by their path.
fn is_alloc_call(full: &str, last: &str) -> bool {
    const OWNERS: [&str; 8] = [
        "Vec", "Box", "String", "HashMap", "BTreeMap", "HashSet", "BTreeSet", "VecDeque",
    ];
    const CTORS: [&str; 3] = ["new", "with_capacity", "from"];
    OWNERS.iter().any(|o| full.contains(o)) && CTORS.contains(&last)
}

impl<'ast> Visit<'ast> for RawFn {
    fn visit_expr_unsafe(&mut self, node: &'ast syn::ExprUnsafe) {
        self.security.unsafe_blocks += 1;
        self.enter_nesting();
        visit::visit_expr_unsafe(self, node);
        self.leave_nesting();
    }

    fn visit_type_ptr(&mut self, node: &'ast syn::TypePtr) {
        self.security.raw_ptr += 1;
        visit::visit_type_ptr(self, node);
    }

    fn visit_expr_cast(&mut self, node: &'ast syn::ExprCast) {
        // Treat any `as` cast as potentially lossy; the heat metric flags review.
        self.security.lossy_casts += 1;
        visit::visit_expr_cast(self, node);
    }

    fn visit_expr_await(&mut self, node: &'ast syn::ExprAwait) {
        self.performance.async_points += 1;
        visit::visit_expr_await(self, node);
    }

    fn visit_expr_try(&mut self, node: &'ast syn::ExprTry) {
        self.complexity.cyclomatic += 1;
        visit::visit_expr_try(self, node);
    }

    fn visit_expr_if(&mut self, node: &'ast syn::ExprIf) {
        self.complexity.cyclomatic += 1;
        self.enter_nesting();
        visit::visit_expr_if(self, node);
        self.leave_nesting();
    }

    fn visit_expr_match(&mut self, node: &'ast syn::ExprMatch) {
        self.complexity.cyclomatic += node.arms.len() as u32;
        self.enter_nesting();
        visit::visit_expr_match(self, node);
        self.leave_nesting();
    }

    fn visit_expr_binary(&mut self, node: &'ast syn::ExprBinary) {
        if matches!(node.op, syn::BinOp::And(_) | syn::BinOp::Or(_)) {
            self.complexity.cyclomatic += 1;
        }
        visit::visit_expr_binary(self, node);
    }

    fn visit_expr_for_loop(&mut self, node: &'ast syn::ExprForLoop) {
        self.enter_loop();
        visit::visit_expr_for_loop(self, node);
        self.leave_loop();
    }

    fn visit_expr_while(&mut self, node: &'ast syn::ExprWhile) {
        self.enter_loop();
        visit::visit_expr_while(self, node);
        self.leave_loop();
    }

    fn visit_expr_loop(&mut self, node: &'ast syn::ExprLoop) {
        self.enter_loop();
        visit::visit_expr_loop(self, node);
        self.leave_loop();
    }

    fn visit_expr_method_call(&mut self, node: &'ast syn::ExprMethodCall) {
        let method = node.method.to_string();
        match method.as_str() {
            "unwrap" => self.security.unwraps += 1,
            "expect" => self.security.expects += 1,
            "clone" => self.performance.clones += 1,
            "collect" => self.performance.collects += 1,
            "to_string" | "to_owned" | "to_vec" => self.performance.allocs += 1,
            _ => {}
        }
        self.calls.push(method);
        visit::visit_expr_method_call(self, node);
    }

    fn visit_expr_call(&mut self, node: &'ast syn::ExprCall) {
        if let syn::Expr::Path(p) = node.func.as_ref() {
            let last = last_segment(&p.path);
            let full = full_path(&p.path);
            if full.ends_with("transmute") {
                self.security.transmute += 1;
            }
            if is_alloc_call(&full, &last) {
                self.performance.allocs += 1;
            }
            if last == self.own_name {
                self.performance.recursion += 1;
            }
            self.calls.push(last);
        }
        visit::visit_expr_call(self, node);
    }

    fn visit_macro(&mut self, node: &'ast syn::Macro) {
        match last_segment(&node.path).as_str() {
            "panic" | "unreachable" | "todo" | "unimplemented" => self.security.panics += 1,
            "vec" | "format" => self.performance.allocs += 1,
            _ => {}
        }
        visit::visit_macro(self, node);
    }
}

impl RawFn {
    fn enter_loop(&mut self) {
        self.complexity.cyclomatic += 1;
        self.loop_depth += 1;
        if self.loop_depth >= 2 {
            self.performance.nested_loops += 1;
        }
        self.enter_nesting();
    }

    fn leave_loop(&mut self) {
        self.loop_depth = self.loop_depth.saturating_sub(1);
        self.leave_nesting();
    }
}
