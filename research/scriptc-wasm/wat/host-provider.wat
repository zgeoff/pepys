;; Core module of the host-provider component: it answers every pull request number read with 42.
(module
  (memory (export "memory") 1)
  (global $next (mut i32) (i32.const 1024))
  (func (export "cabi_realloc") (param i32 i32 i32 i32) (result i32)
    (local $pointer i32)
    (local.set $pointer (global.get $next))
    (global.set $next (i32.add (global.get $next) (local.get 3)))
    (local.get $pointer))
  (func (export "pepys:spike/host#read-pull-request-number") (param i32 i32) (result f64)
    (f64.const 42))
  (func (export "pepys:spike/host#panic") (param i32 i32) unreachable))
